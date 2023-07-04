const fs = require('fs');
const childProcess = require('child_process');
const createLogger = require('./logger');
const logger = createLogger(module);

async function runPython(workingdir, script, args) {
  const pythonBin = JSON.parse(fs.readFileSync('config.json').toString()).python;
  const pythonCommand = `${pythonBin} ${script} ${args.join(' ')}`;
  const python = childProcess.exec(pythonCommand, {
    cwd: workingdir,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    }
  });
  await new Promise((resolve, reject) => {
    let stderr = '';
    let stdout = '';
    python.stdout.on('data', (data) => {
      stdout += data;
    });
    python.stderr.on('data', (data) => {
      stderr += data;
    });
    python.on('close', (code, signal) => {
      //console.log('STDERR', stderr);
      if (code === 0) {
        resolve(stdout);
      } else {
        logger.error('python failed', code, signal);
        logger.error(`python command: ${pythonCommand}`);

        logger.warn(`python process exited with code ${code}`);
        const allOutput = `======= stdout =====\n${stdout.slice(0,100)}\n======= stderr =====\n${stderr}`;
        logger.warn(allOutput);
        logger.warn(`python process exited with code ${code}`);

        reject(new Error(`${pythonCommand}\npython process exited with code ${code} and signal ${signal}\n${allOutput}`));
      }
    });
  });
}



module.exports.runPython = runPython;
