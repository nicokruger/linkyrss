const fs = require('fs');
const childProcess = require('child_process');
const createLogger = require('./logger');
const logger = createLogger(module);

const maxBuffer = 10 * 1024 * 1024;
async function pandocToMd(id, htmlFile, mdFile) {
  //const pandocCommand = `pandoc --columns 120 ${htmlFile} -t gfm-raw_html -s --wrap none --strip-comments --lua-filter=remove-attr.lua`;
  const pandocCommand = `pandoc --columns 120 ${htmlFile} -t markdown-simple_tables-pipe_tables+grid_tables+fenced_divs-yaml_metadata_block -s --strip-comments --lua-filter=remove-attr2.lua`;
  console.log(`running pandoc command: ${pandocCommand}`);
  const pandoc = childProcess.exec(pandocCommand, {
    maxBuffer
  });
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
        logger.error('pandoc failed', code, signal);
        logger.error(`pandoc command: ${pandocCommand}`);

        logger.warn(`pandoc process exited with code ${code}`);
        logger.warn('======= stdout =====');
        logger.warn(stdout.slice(0,100));
        logger.warn('======= stderr =====');
        logger.warn(stderr);
        logger.warn(`pandoc process exited with code ${code}`);

        reject(new Error(`pandoc process exited with code ${code} and signal ${signal}`));
      }
    });
  });
  //console.log(`writing to file: ${mdFile}`);
  fs.writeFileSync(mdFile, pandocStdout);
}

async function pandocToHtml(mdFile, htmlFile) {
  const pandocCommand = `pandoc --columns 120 ${mdFile} -t html -s --wrap none --strip-comments`;
  logger.debug(`running pandoc command: ${pandocCommand}`);
  const pandoc = childProcess.exec(pandocCommand, {
    maxBuffer
  });
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
        logger.error('pandoc failed', code, signal);

        logger.warn(`pandoc process exited with code ${code}`);
        logger.warn('======= stdout =====');
        logger.warn(stdout.slice(0,100));
        logger.warn('.........');
        logger.warn(stdout.slice(-100));
        logger.warn('======= stderr =====');
        logger.warn(stderr);
        logger.warn(`pandoc process exited with code ${code}`);

        reject(new Error(`pandoc process exited with code ${code} and signal ${signal}`));
      }
    });
  });
  //console.log(`writing to file: ${mdFile}`);
  fs.writeFileSync(htmlFile, pandocStdout);
}


module.exports.pandocToMd = pandocToMd;
module.exports.pandocToHtml = pandocToHtml;
