import { isMSField, convertMSFieldToLabel } from './complexChromatogram';
import convertToFloatArray from './convertToFloatArray';
import fastParseXYData from './parse/fastParseXYData';
import parsePeakTable from './parse/parsePeakTable';
import parseXYA from './parse/parseXYA';
import prepareSpectrum from './prepareSpectrum';
import profiling from './profiling';
import postProcessing from './postProcessing';

// the following RegExp can only be used for XYdata, some peakTables have values with a "E-5" ...
const ntuplesSeparator = /[, \t]+/;

class Spectrum {}

const defaultOptions = {
  keepRecordsRegExp: /^$/,
  canonicDataLabels: true,
  dynamicTyping: false,
  xy: true,
  withoutXY: false,
  chromatogram: false,
  keepSpectra: false,
  noContour: false,
  nbContourLevels: 7,
  noiseMultiplier: 5,
  profiling: false,
};

export default function convert(jcamp, options) {
  options = Object.assign({}, defaultOptions, options);
  options.wantXY = !options.withoutXY;
  options.start = Date.now();

  let entriesFlat = [];
  let entriesStack = [];
  let ntupleLevel = 0;

  let result = {};

  result.profiling = options.profiling ? [] : false;
  result.logs = [];
  result.spectra = [];
  result.ntuples = {};
  result.info = {};
  let spectrum = new Spectrum();

  if (!(typeof jcamp === 'string')) {
    throw new TypeError('the JCAMP should be a string');
  }

  profiling(result, 'Before split to LDRS', options);

  let ldrs = jcamp.split(/[\r\n]+##/);

  profiling(result, 'Split to LDRS', options);

  if (ldrs[0]) ldrs[0] = ldrs[0].replace(/^[\r\n ]*##/, '');

  for (let ldr of ldrs) {
    // This is a new LDR
    let position = ldr.indexOf('=');
    let dataLabel = position > 0 ? ldr.substring(0, position) : ldr;
    let dataValue = position > 0 ? ldr.substring(position + 1).trim() : '';

    let canonicDataLabel = dataLabel.replace(/[_ -]/g, '').toUpperCase();

    if (canonicDataLabel === 'DATATABLE') {
      let endLine = dataValue.indexOf('\n');
      if (endLine === -1) endLine = dataValue.indexOf('\r');
      if (endLine > 0) {
        let xIndex = -1;
        let yIndex = -1;
        // ##DATA TABLE= (X++(I..I)), XYDATA
        // We need to find the variables

        let infos = dataValue.substring(0, endLine).split(/[ ,;\t]+/);
        if (infos[0].indexOf('++') > 0) {
          let firstVariable = infos[0].replace(
            /.*\(([a-zA-Z0-9]+)\+\+.*/,
            '$1',
          );
          let secondVariable = infos[0].replace(/.*\.\.([a-zA-Z0-9]+).*/, '$1');
          xIndex = result.ntuples.symbol.indexOf(firstVariable);
          yIndex = result.ntuples.symbol.indexOf(secondVariable);
        }

        if (xIndex === -1) xIndex = 0;
        if (yIndex === -1) yIndex = 0;

        if (result.ntuples.first) {
          if (result.ntuples.first.length > xIndex) {
            spectrum.firstX = result.ntuples.first[xIndex];
          }
          if (result.ntuples.first.length > yIndex) {
            spectrum.firstY = result.ntuples.first[yIndex];
          }
        }
        if (result.ntuples.last) {
          if (result.ntuples.last.length > xIndex) {
            spectrum.lastX = result.ntuples.last[xIndex];
          }
          if (result.ntuples.last.length > yIndex) {
            spectrum.lastY = result.ntuples.last[yIndex];
          }
        }
        if (result.ntuples.vardim && result.ntuples.vardim.length > xIndex) {
          spectrum.nbPoints = result.ntuples.vardim[xIndex];
        }
        if (result.ntuples.factor) {
          if (result.ntuples.factor.length > xIndex) {
            spectrum.xFactor = result.ntuples.factor[xIndex];
          }
          if (result.ntuples.factor.length > yIndex) {
            spectrum.yFactor = result.ntuples.factor[yIndex];
          }
        }
        if (result.ntuples.units) {
          if (result.ntuples.units.length > xIndex) {
            spectrum.xUnit = result.ntuples.units[xIndex];
          }
          if (result.ntuples.units.length > yIndex) {
            spectrum.yUnit = result.ntuples.units[yIndex];
          }
        }
        spectrum.datatable = infos[0];
        if (infos[1] && infos[1].indexOf('PEAKS') > -1) {
          canonicDataLabel = 'PEAKTABLE';
        } else if (
          infos[1] &&
          (infos[1].indexOf('XYDATA') || infos[0].indexOf('++') > 0)
        ) {
          canonicDataLabel = 'XYDATA';
          spectrum.deltaX =
            (spectrum.lastX - spectrum.firstX) / (spectrum.nbPoints - 1);
        }
      }
    }

    if (canonicDataLabel === 'XYDATA') {
      if (options.wantXY) {
        prepareSpectrum(spectrum);
        // well apparently we should still consider it is a PEAK TABLE if there are no '++' after
        if (dataValue.match(/.*\+\+.*/)) {
          // ex: (X++(Y..Y))
          if (!spectrum.deltaX) {
            spectrum.deltaX =
              (spectrum.lastX - spectrum.firstX) / (spectrum.nbPoints - 1);
          }
          fastParseXYData(spectrum, dataValue, result);
        } else {
          parsePeakTable(spectrum, dataValue, result);
        }
        result.spectra.push(spectrum);
        spectrum = new Spectrum();
      }
      continue;
    } else if (canonicDataLabel === 'PEAKTABLE') {
      if (options.wantXY) {
        prepareSpectrum(spectrum);
        parsePeakTable(spectrum, dataValue, result);
        result.spectra.push(spectrum);
        spectrum = new Spectrum();
      }
      continue;
    }
    if (canonicDataLabel === 'PEAKASSIGNMENTS') {
      if (options.wantXY) {
        if (dataValue.match(/.*(XYA).*/)) {
          // ex: (XYA)
          parseXYA(spectrum, dataValue);
        }
        result.spectra.push(spectrum);
        spectrum = new Spectrum();
      }
      continue;
    }

    if (canonicDataLabel === 'TITLE') {
      spectrum.title = dataValue;
    } else if (canonicDataLabel === 'DATATYPE') {
      spectrum.dataType = dataValue;
      if (dataValue.indexOf('nD') > -1) {
        result.twoD = true;
      }
    } else if (canonicDataLabel === 'NTUPLES') {
      ntupleLevel++;
      if (dataValue.indexOf('nD') > -1) {
        result.twoD = true;
      }
    } else if (canonicDataLabel === 'XUNITS') {
      spectrum.xUnit = dataValue;
    } else if (canonicDataLabel === 'YUNITS') {
      spectrum.yUnit = dataValue;
    } else if (canonicDataLabel === 'FIRSTX') {
      spectrum.firstX = parseFloat(dataValue);
    } else if (canonicDataLabel === 'LASTX') {
      spectrum.lastX = parseFloat(dataValue);
    } else if (canonicDataLabel === 'FIRSTY') {
      spectrum.firstY = parseFloat(dataValue);
    } else if (canonicDataLabel === 'LASTY') {
      spectrum.lastY = parseFloat(dataValue);
    } else if (canonicDataLabel === 'NPOINTS') {
      spectrum.nbPoints = parseFloat(dataValue);
    } else if (canonicDataLabel === 'XFACTOR') {
      spectrum.xFactor = parseFloat(dataValue);
    } else if (canonicDataLabel === 'YFACTOR') {
      spectrum.yFactor = parseFloat(dataValue);
    } else if (canonicDataLabel === 'MAXX') {
      spectrum.maxX = parseFloat(dataValue);
    } else if (canonicDataLabel === 'MINX') {
      spectrum.minX = parseFloat(dataValue);
    } else if (canonicDataLabel === 'MAXY') {
      spectrum.maxY = parseFloat(dataValue);
    } else if (canonicDataLabel === 'MINY') {
      spectrum.minY = parseFloat(dataValue);
    } else if (canonicDataLabel === 'DELTAX') {
      spectrum.deltaX = parseFloat(dataValue);
    } else if (
      canonicDataLabel === '.OBSERVEFREQUENCY' ||
      canonicDataLabel === '$SFO1'
    ) {
      if (!spectrum.observeFrequency) {
        spectrum.observeFrequency = parseFloat(dataValue);
      }
    } else if (canonicDataLabel === '.OBSERVENUCLEUS') {
      if (!spectrum.xType) {
        result.xType = dataValue.replace(/[^a-zA-Z0-9]/g, '');
      }
    } else if (canonicDataLabel === '$SFO2') {
      if (!result.indirectFrequency) {
        result.indirectFrequency = parseFloat(dataValue);
      }
    } else if (canonicDataLabel === '$OFFSET') {
      // OFFSET for Bruker spectra
      result.shiftOffsetNum = 0;
      if (!spectrum.shiftOffsetVal) {
        spectrum.shiftOffsetVal = parseFloat(dataValue);
      }
    } else if (canonicDataLabel === '$REFERENCEPOINT') {
      // OFFSET for Varian spectra
      // if we activate this part it does not work for ACD specmanager
      //         } else if (canonicDataLabel=='.SHIFTREFERENCE') {   // OFFSET FOR Bruker Spectra
      //                 var parts = dataValue.split(/ *, */);
      //                 result.shiftOffsetNum = parseInt(parts[2].trim());
      //                 spectrum.shiftOffsetVal = parseFloat(parts[3].trim());
    } else if (canonicDataLabel === 'VARNAME') {
      result.ntuples.varname = dataValue.split(ntuplesSeparator);
    } else if (canonicDataLabel === 'SYMBOL') {
      result.ntuples.symbol = dataValue.split(ntuplesSeparator);
    } else if (canonicDataLabel === 'VARTYPE') {
      result.ntuples.vartype = dataValue.split(ntuplesSeparator);
    } else if (canonicDataLabel === 'VARFORM') {
      result.ntuples.varform = dataValue.split(ntuplesSeparator);
    } else if (canonicDataLabel === 'VARDIM') {
      result.ntuples.vardim = convertToFloatArray(
        dataValue.split(ntuplesSeparator),
      );
    } else if (canonicDataLabel === 'UNITS') {
      result.ntuples.units = dataValue.split(ntuplesSeparator);
    } else if (canonicDataLabel === 'FACTOR') {
      result.ntuples.factor = convertToFloatArray(
        dataValue.split(ntuplesSeparator),
      );
    } else if (canonicDataLabel === 'FIRST') {
      result.ntuples.first = convertToFloatArray(
        dataValue.split(ntuplesSeparator),
      );
    } else if (canonicDataLabel === 'LAST') {
      result.ntuples.last = convertToFloatArray(
        dataValue.split(ntuplesSeparator),
      );
    } else if (canonicDataLabel === 'MIN') {
      result.ntuples.min = convertToFloatArray(
        dataValue.split(ntuplesSeparator),
      );
    } else if (canonicDataLabel === 'MAX') {
      result.ntuples.max = convertToFloatArray(
        dataValue.split(ntuplesSeparator),
      );
    } else if (canonicDataLabel === '.NUCLEUS') {
      if (result.twoD) {
        result.yType = dataValue.split(ntuplesSeparator)[0];
      }
    } else if (canonicDataLabel === 'PAGE') {
      spectrum.page = dataValue.trim();
      spectrum.pageValue = parseFloat(dataValue.replace(/^.*=/, ''));
      spectrum.pageSymbol = spectrum.page.replace(/[=].*/, '');
      let pageSymbolIndex = result.ntuples.symbol.indexOf(spectrum.pageSymbol);
      let unit = '';
      if (result.ntuples.units && result.ntuples.units[pageSymbolIndex]) {
        unit = result.ntuples.units[pageSymbolIndex];
      }
      if (result.indirectFrequency && unit !== 'PPM') {
        spectrum.pageValue /= result.indirectFrequency;
      }
    } else if (canonicDataLabel === 'RETENTIONTIME') {
      spectrum.pageValue = parseFloat(dataValue);
    } else if (isMSField(canonicDataLabel)) {
      spectrum[convertMSFieldToLabel(canonicDataLabel)] = dataValue;
    } else if (canonicDataLabel === 'SAMPLEDESCRIPTION') {
      spectrum.sampleDescription = dataValue;
    } else if (canonicDataLabel === 'END') {
      // todo
    }

    if (canonicDataLabel === 'END' && ntupleLevel > 0) {
      ntupleLevel--;
    }

    if (canonicDataLabel.match(options.keepRecordsRegExp)) {
      let label = options.canonicDataLabels ? canonicDataLabel : dataLabel;
      let value = dataValue.trim();
      if (options.dynamicTyping && !isNaN(value)) {
        value = Number(value);
      }
      if (result.info[label]) {
        if (!Array.isArray(result.info[label])) {
          result.info[label] = [result.info[label]];
        }
        result.info[label].push(value);
      } else {
        result.info[label] = value;
      }
    }
  }

  profiling(result, 'Finished parsing', options);

  postProcessing(result, options);

  profiling(result, 'Total time', options);

  return result;
}