import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function baseIdFromQuery(query) {
  return query.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function parseArgs(argv) {
  const out = { query: null, baseDir: null, outputFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base-dir' && i + 1 < argv.length) {
      out.baseDir = String(argv[i + 1]);
      i++;
      continue;
    }
    if (a === '--output-file' && i + 1 < argv.length) {
      out.outputFile = String(argv[i + 1]);
      i++;
      continue;
    }
    if (!a.startsWith('-') && !out.query) out.query = String(a);
  }
  return out;
}

const { query: searchQuery, baseDir: baseDirArg, outputFile: outputFileArg } =
  parseArgs(process.argv.slice(2));

if (!baseDirArg && !searchQuery) {
  console.error('Usage: node layerer.js <query> [--base-dir <dir>] [--output-file <file>]');
  process.exit(1);
}

const baseDir = baseDirArg
  ? path.resolve(baseDirArg)
  : path.join('output', baseIdFromQuery(searchQuery));
const stretchedSongsDir = path.join(baseDir, 'stretched_songs');
const outputFile =
  outputFileArg
    ? path.resolve(outputFileArg)
    : baseDirArg
      ? path.join(baseDir, 'layered.wav')
      : path.join(baseDir, `layered_${baseIdFromQuery(searchQuery)}.wav`);

function layerSongs() {
  console.log('Starting song layering process...');

  // Get all WAV files in the stretched_songs directory
  const files = fs
    .readdirSync(stretchedSongsDir)
    .filter((file) => path.extname(file).toLowerCase() === '.wav');

  if (files.length === 0) {
    console.log('No WAV files found in the stretched_songs directory.');
    process.exitCode = 1;
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
    process.exitCode = 1;
  }
}

layerSongs();
