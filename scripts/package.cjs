const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const outputDir = path.resolve(__dirname, '../dist');
const outputFile = path.resolve(outputDir, 'gesture-x.zip');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const output = fs.createWriteStream(outputFile);
const archive = archiver('zip', {
  zlib: { level: 9 } // Maximum compression
});

output.on('close', () => {
  console.log(`Successfully created gesture-x.zip (${archive.pointer()} total bytes)`);
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// Files and directories to include in the zip
const dirsToInclude = ['assets', 'src'];
const filesToInclude = ['manifest.json', 'package.json', 'README.md', 'PRIVACY_POLICY.md'];

for (const dir of dirsToInclude) {
  const dirPath = path.resolve(__dirname, `../${dir}`);
  if (fs.existsSync(dirPath)) {
    archive.directory(dirPath, dir);
  }
}

for (const file of filesToInclude) {
  const filePath = path.resolve(__dirname, `../${file}`);
  if (fs.existsSync(filePath)) {
    archive.file(filePath, { name: file });
  }
}

archive.finalize();
