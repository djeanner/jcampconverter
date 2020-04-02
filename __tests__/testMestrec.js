'use strict';

let fs = require('fs');

let Converter = require('..');

describe('Test from Mestrec Jcamp generator', function () {
  it('NMR 1H spectrum 256', function () {
    let result = Converter.convert(
      fs.readFileSync(`${__dirname}/data/mestrec/jcamp-256.jdx`).toString(),
      { xy: true },
    );
    let data = result.spectra[0].data[0];
    expect(data.x).toHaveLength(256);
    expect(data.y).toHaveLength(256);
  });

  it('NMR 1H spectrum 1024', function () {
    let result = Converter.convert(
      fs.readFileSync(`${__dirname}/data/mestrec/jcamp-1024.jdx`).toString(),
      { xy: true },
    );
    let data = result.spectra[0].data[0];
    expect(data.x).toHaveLength(1024);
    expect(data.y).toHaveLength(1024);
  });

  it('NMR 1H spectrum difdup', function () {
    let result = Converter.convert(
      fs.readFileSync(`${__dirname}/data/mestrec/jcamp-difdup.jdx`).toString(),
      { xy: true },
    );
    let data = result.spectra[0].data[0];
    expect(data.x).toHaveLength(16384);
    expect(data.y).toHaveLength(16384);
    // console.log(data.x.length, Math.max(...data.x), Math.min(...data.x));
    // console.log(data.y.length, Math.max(...data.y), Math.min(...data.y));
  });
});
