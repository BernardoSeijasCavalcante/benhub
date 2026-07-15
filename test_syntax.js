const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dirs = [
  __dirname,
  path.join(__dirname, 'src', 'routes'),
  path.join(__dirname, 'src', 'middleware')
];

let hasError = false;

dirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(file => {
      if (file.endsWith('.js')) {
        const fullPath = path.join(dir, file);
        try {
          execSync(`node -c "${fullPath}"`, { stdio: 'pipe' });
        } catch (e) {
          console.error(`Syntax error in ${fullPath}:`);
          console.error(e.stderr.toString());
          hasError = true;
        }
      }
    });
  }
});

if (!hasError) {
  console.log('All files passed syntax check.');
}
