import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const searchQuery = process.argv[2];
const baseDir = path.join(
  'output',
  searchQuery.replace(/[^a-z0-9]/gi, '_').toLowerCase()
);
const stretchedSongsDir = path.join(baseDir, 'stretched_songs');
const outputFile = path.join(baseDir, `layered_${searchQuery}.wav`);

function layerSongs() {
  console.log('Starting song layering process...');

  // Get all WAV files in the stretched_songs directory
  const files = fs
    .readdirSync(stretchedSongsDir)
    .filter((file) => path.extname(file).toLowerCase() === '.wav');

  if (files.length === 0) {
    console.log('No WAV files found in the stretched_songs directory.');
    return;
  }

  console.log(`Found ${files.length} WAV files to layer.`);

  // Prepare the ffmpeg command
  let ffmpegCommand = 'ffmpeg';

  // Add input files
  files.forEach((file) => {
    ffmpegCommand += ` -i "${path.join(stretchedSongsDir, file)}"`;
  });

  // Add filter complex for mixing
  ffmpegCommand += ' -filter_complex "';
  files.forEach((_, index) => {
    ffmpegCommand += `[${index}:a]`;
  });
  ffmpegCommand += `amix=inputs=${files.length}:duration=longest" `;

  // Add output file
  ffmpegCommand += `"${outputFile}" -y`;

  console.log('Layering songs...');
  try {
    execSync(ffmpegCommand);
    console.log(`Layering complete. Output saved as ${outputFile}`);
  } catch (error) {
    console.error('An error occurred during the layering process:');
    console.error(error.message);
  }
}

layerSongs();
