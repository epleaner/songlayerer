import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { parseFile } from 'music-metadata';

const searchQuery = process.argv[2];
const baseDir = path.join(
  'output',
  searchQuery.replace(/[^a-z0-9]/gi, '_').toLowerCase()
);
const songsDir = path.join(baseDir, 'songs');
const outputDir = path.join(baseDir, 'stretched_songs');
const rubberbandPath = './lib/rubberband/rubberband-r3';

const ffmpegCommand = `ffmpeg -hide_banner -loglevel error -i`;

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function trimSilence(inputPath, outputPath) {
  console.log('Trimming silence...');
  execSync(
    `${ffmpegCommand} "${inputPath}" -af silenceremove=stop_periods=-1:stop_threshold=-45dB:stop_duration=1,areverse,silenceremove=stop_periods=-1:stop_threshold=-45dB:stop_duration=1,areverse "${outputPath}"`
  );
}

async function getLongestSongDuration(directory) {
  const files = fs
    .readdirSync(directory)
    .filter((file) => path.extname(file).toLowerCase() === '.mp3');
  let maxDuration = 0;
  let longestFile = '';

  for (const file of files) {
    const inputPath = path.join(directory, file);
    const trimmedWavPath = path.join(
      outputDir,
      `trimmed_${file.replace('.mp3', '.wav')}`
    );

    console.log(`\nAnalyzing: ${file}`);
    trimSilence(inputPath, trimmedWavPath);

    const metadata = await parseFile(trimmedWavPath);
    if (metadata.format.duration > maxDuration) {
      maxDuration = metadata.format.duration;
      longestFile = file;
    }
  }

  console.log(
    `\nLongest song: ${longestFile} (${maxDuration.toFixed(2)} seconds)`
  );
  return maxDuration;
}

function cleanOutputDirectory(directory) {
  console.log(`Cleaning output directory: ${directory}`);
  if (fs.existsSync(directory)) {
    fs.readdirSync(directory).forEach((file) => {
      const filePath = path.join(directory, file);
      fs.unlinkSync(filePath);
    });
    console.log('Output directory cleaned.');
  } else {
    console.log('Output directory does not exist. Creating it.');
    fs.mkdirSync(directory, { recursive: true });
  }
}

async function stretchSongs() {
  console.log('Starting song stretching process...');

  // Clean the output directory before processing
  cleanOutputDirectory(outputDir);

  // Check if songsDir exists
  if (!fs.existsSync(songsDir)) {
    console.error(`Error: The songs directory '${songsDir}' does not exist.`);
    return;
  }

  const longestDuration = await getLongestSongDuration(songsDir);
  const files = fs
    .readdirSync(songsDir)
    .filter((file) => path.extname(file).toLowerCase() === '.mp3');

  const songAlterations = [];

  for (const file of files) {
    console.log(`\nProcessing: ${file}`);
    const inputPath = path.join(songsDir, file);
    const outputPath = path.join(
      outputDir,
      `stretched_${file.replace('.mp3', '.wav')}`
    );
    const trimmedWavPath = path.join(
      outputDir,
      `trimmed_${file.replace('.mp3', '.wav')}`
    );

    // We'll use the already trimmed file
    console.log('Getting current song duration...');
    const metadata = await parseFile(trimmedWavPath);
    const currentDuration = metadata.format.duration;

    const timeRatio = longestDuration / currentDuration;
    console.log(`Current duration: ${currentDuration.toFixed(2)} seconds`);
    console.log(`Time ratio for stretching: ${timeRatio.toFixed(3)}`);

    console.log('Time-stretching using rubberband...');
    execSync(
      `"${rubberbandPath}" -t ${timeRatio.toFixed(
        3
      )} -p 0 "${trimmedWavPath}" "${outputPath}"`
    );

    console.log('Removing temporary WAV file...');
    fs.unlinkSync(trimmedWavPath);

    console.log(`Stretched ${file} to ${longestDuration.toFixed(2)} seconds`);

    songAlterations.push({
      file,
      originalDuration: currentDuration,
      stretchedDuration: longestDuration,
      timeRatio,
    });
  }

  console.log('\nAll songs have been processed and stretched.');

  // Log time alterations
  console.log('\nTime alterations for each song:');
  songAlterations.forEach(
    ({ file, originalDuration, stretchedDuration, timeRatio }) => {
      console.log(`${file}:`);
      console.log(
        `  Original duration: ${originalDuration.toFixed(2)} seconds`
      );
      console.log(
        `  Stretched duration: ${stretchedDuration.toFixed(2)} seconds`
      );
      console.log(`  Time ratio: ${timeRatio.toFixed(3)}`);
      console.log(`  Alteration: ${((timeRatio - 1) * 100).toFixed(2)}%`);
      console.log('');
    }
  );
}

stretchSongs().catch((error) => {
  console.error('An error occurred during the stretching process:');
  console.error(error);
});
