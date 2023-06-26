const fs = require('fs');
const childProcess = require('child_process');

async function pandocToMd(id, htmlFile, mdFile) {
  const pandocCommand = `pandoc --columns 120 ${htmlFile} -t gfm-raw_html -s --wrap none --strip-comments --lua-filter=remove-attr.lua`;
  //console.log(`running pandoc command: ${pandocCommand}`);
  const pandoc = childProcess.exec(pandocCommand);
  const pandocStdout = await new Promise((resolve, reject) => {
    let stderr = '';
    let stdout = '';
    pandoc.stdout.on('data', (data) => {
      stdout += data;
    });
    pandoc.stderr.on('data', (data) => {
      stderr += data;
    });
    pandoc.on('close', (code, signal) => {
      //console.log('STDERR', stderr);
      if (code === 0) {
        resolve(stdout);
      } else {
        console.error('pandoc failed', code, signal);

        console.warn(`pandoc process exited with code ${code}`);
        console.warn('======= stdout =====');
        console.warn(stdout.slice(0,100));
        console.warn('======= stderr =====');
        console.warn(stderr);
        console.warn(`pandoc process exited with code ${code}`);

        reject(new Error(`pandoc process exited with code ${code} and signal ${signal}`));
      }
    });
  });
  //console.log(`writing to file: ${mdFile}`);
  fs.writeFileSync(mdFile, pandocStdout);
}

async function pandocToHtml(mdFile, htmlFile) {
  const pandocCommand = `pandoc --columns 120 ${mdFile} -t html -s --wrap none --strip-comments`;
  console.log(`running pandoc command: ${pandocCommand}`);
  const pandoc = childProcess.exec(pandocCommand);
  const pandocStdout = await new Promise((resolve, reject) => {
    let stderr = '';
    let stdout = '';
    pandoc.stdout.on('data', (data) => {
      stdout += data;
    });
    pandoc.stderr.on('data', (data) => {
      stderr += data;
    });
    pandoc.on('close', (code, signal) => {
      //console.log('STDERR', stderr);
      if (code === 0) {
        resolve(stdout);
      } else {
        console.error('pandoc failed', code, signal);

        console.warn(`pandoc process exited with code ${code}`);
        console.warn('======= stdout =====');
        console.warn(stdout.slice(0,100));
        console.warn('======= stderr =====');
        console.warn(stderr);
        console.warn(`pandoc process exited with code ${code}`);

        reject(new Error(`pandoc process exited with code ${code} and signal ${signal}`));
      }
    });
  });
  //console.log(`writing to file: ${mdFile}`);
  fs.writeFileSync(htmlFile, pandocStdout);
}


module.exports.pandocToMd = pandocToMd;
module.exports.pandocToHtml = pandocToHtml;
