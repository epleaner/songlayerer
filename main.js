import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { downloadTopCovers } from './songdl.js';

// Function to execute a command and return a promise
function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`);
      }
      console.log(`stdout: ${stdout}`);
      resolve(stdout);
    });
  });
}

// Main function to run both scripts
async function processAudio(
  searchQuery,
  downloadSongs = false,
  numCovers = 5,
  excludeKeywords = []
) {
  const baseDir = path.join(
    'output',
    searchQuery.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  );

  try {
    // Create base directory if it doesn't exist
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    if (downloadSongs) {
      console.log(`Downloading top ${numCovers} versions of ${searchQuery}...`);
      downloadTopCovers(searchQuery, numCovers, baseDir, excludeKeywords);
    }

    console.log('Running timestretch.js...');
    await runCommand(`node timestretch.js "${searchQuery}"`);

    console.log('Running layerer.js...');
    await runCommand(`node layerer.js "${searchQuery}"`);

    console.log('Audio processing completed successfully!');
  } catch (error) {
    console.error('An error occurred during audio processing:', error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let searchQuery,
  downloadSongs = false,
  numCovers = 5,
  excludeKeywords = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--download' || args[i] === '-d') {
    downloadSongs = true;
  } else if (args[i] === '--number' || args[i] === '-n') {
    if (i + 1 < args.length && !isNaN(parseInt(args[i + 1]))) {
      numCovers = parseInt(args[i + 1]);
      i++;
    }
  } else if (args[i] === '--exclude' || args[i] === '-e') {
    if (i + 1 < args.length) {
      excludeKeywords = args[i + 1].split(',');
      i++;
    }
  } else if (!searchQuery) {
    searchQuery = args[i];
  }
}

if (!searchQuery) {
  console.error('Please provide a search query as a command line argument.');
  console.log(
    'Usage: node main.js [--download|-d] [--number|-n num_covers] [--exclude|-e "keyword1,keyword2,..."] "search query"'
  );
  process.exit(1);
}

// Run the main function
processAudio(searchQuery, downloadSongs, numCovers, excludeKeywords);
