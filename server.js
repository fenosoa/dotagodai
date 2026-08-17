const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname)); // Serve HTML/CSS/JS files

// Default Dota 2 replay path
const DEFAULT_DOTA_PATH = path.join(
    'C:',
    'Program Files (x86)',
    'Steam',
    'steamapps',
    'common',
    'dota 2 beta',
    'game',
    'dota',
    'replays'
);

// Where uploaded .dem files and Gradle task output land. Deliberately kept
// *inside the project* (rather than os.tmpdir()) because it must never contain
// a space in its path -- see the long comment on runGradleTask() below for why.
const IO_DIR = path.join(__dirname, '.gradle-io');
if (!fs.existsSync(IO_DIR)) {
    fs.mkdirSync(IO_DIR, { recursive: true });
}

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, IO_DIR),
        filename: (req, file, cb) => {
            const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
            cb(null, `${Date.now()}_${safeName}`);
        }
    }),
    limits: { fileSize: 300 * 1024 * 1024 }, // replays can be large
    fileFilter: (req, file, cb) => {
        if (!/\.dem$/i.test(file.originalname)) {
            return cb(new Error('Only .dem files are allowed'));
        }
        cb(null, true);
    }
});

const GRADLEW_CMD = process.platform === 'win32'
    ? path.join(__dirname, 'gradlew.bat')
    : path.join(__dirname, 'gradlew');

// Gradle's `--args` CLI option takes ONE string that Gradle itself re-splits into
// individual task arguments (space-separated, its own tokenizer). To reach Gradle
// intact, that whole string must survive as a single token through cmd.exe and
// gradlew.bat's own argument forwarding first. In practice (verified empirically
// against this exact setup), a single pair of outer quotes around the whole
// --args value survives that trip -- but a space *inside* one of the individual
// path arguments does not, no matter how it's escaped/nested. So: every argument
// must be free of spaces and quotes, full stop. That's why replay/output paths
// are generated under IO_DIR (project-local, no spaces) instead of os.tmpdir()
// (which can contain the Windows username, e.g. "C:\Users\John Smith\...").
const UNSAFE_ARG = /[\s"]/;

/**
 * Run a Gradle example task (matchinfoRun / pathRun) with a set of positional
 * string/number arguments, forwarded via Gradle's `--args` option.
 */
function runGradleTask(taskName, positionalArgs, callback) {
    for (const a of positionalArgs) {
        if (UNSAFE_ARG.test(String(a))) {
            return callback(new Error(
                `Argument "${a}" contains a space or quote, which the Gradle CLI wrapper can't ` +
                `pass through reliably on Windows. Move the file to a path without spaces.`
            ));
        }
    }

    const argsValue = positionalArgs.map(String).join(' ');
    const command = `"${GRADLEW_CMD}" ${taskName} --args "${argsValue}"`;

    exec(command, { cwd: __dirname, maxBuffer: 10 * 1024 * 1024 }, callback);
}

/**
 * GET /api/scan-directory
 * Scan a directory for .dem files
 * Query params: ?dir=<directory_path>
 */
app.get('/api/scan-directory', (req, res) => {
    const dirPath = req.query.dir || DEFAULT_DOTA_PATH;

    console.log(`Scanning directory: ${dirPath}`);

    if (!fs.existsSync(dirPath)) {
        return res.status(404).json({
            error: 'Directory not found',
            path: dirPath
        });
    }

    try {
        const files = fs.readdirSync(dirPath);
        const demFiles = files
            .filter(file => file.toLowerCase().endsWith('.dem'))
            .map(file => {
                const filePath = path.join(dirPath, file);
                const stats = fs.statSync(filePath);

                return {
                    name: file,
                    path: filePath,
                    size: stats.size,
                    modified: stats.mtime.toISOString()
                };
            });

        res.json({
            directory: dirPath,
            files: demFiles,
            count: demFiles.length
        });
    } catch (error) {
        console.error('Error scanning directory:', error);
        res.status(500).json({
            error: 'Failed to scan directory',
            message: error.message
        });
    }
});

/**
 * POST /api/replays/upload
 * Upload a .dem file so it can be handed to the Gradle tasks below, which need
 * a real path on disk (a dropped/picked File in the browser only exposes bytes).
 * Body: multipart/form-data, field name "replay"
 */
app.post('/api/replays/upload', (req, res) => {
    upload.single('replay')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: 'Upload failed', message: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        console.log(`Replay uploaded: ${req.file.originalname} -> ${req.file.path}`);

        res.json({
            success: true,
            path: req.file.path,
            name: req.file.originalname,
            size: req.file.size
        });
    });
});

/**
 * POST /api/parse-replay
 * Parse a .dem file and return match information (players, heroes, ids, ...)
 * Body: { filePath: string }
 */
app.post('/api/parse-replay', (req, res) => {
    const { filePath } = req.body;

    if (!filePath) {
        return res.status(400).json({ error: 'No file path provided' });
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found', path: filePath });
    }

    console.log(`Parsing replay (matchinfo): ${filePath}`);

    const tempOutputPath = path.join(IO_DIR, `match_${Date.now()}.json`);

    runGradleTask('matchinfoRun', [filePath, tempOutputPath], (error, stdout, stderr) => {
        if (error) {
            console.error('Parsing error:', error);
            console.error('stderr:', stderr);

            if (fs.existsSync(tempOutputPath)) {
                fs.unlinkSync(tempOutputPath);
            }

            return res.status(500).json({
                error: 'Failed to parse replay',
                message: error.message,
                details: stderr
            });
        }

        console.log('Parser output:', stdout);

        try {
            if (!fs.existsSync(tempOutputPath)) {
                throw new Error('Output file was not created');
            }

            const jsonData = fs.readFileSync(tempOutputPath, 'utf8');
            const matchData = JSON.parse(jsonData);

            fs.unlinkSync(tempOutputPath);

            res.json({
                success: true,
                data: matchData,
                filePath: filePath
            });
        } catch (readError) {
            console.error('Error reading output:', readError);

            if (fs.existsSync(tempOutputPath)) {
                fs.unlinkSync(tempOutputPath);
            }

            res.status(500).json({
                error: 'Failed to read parsing results',
                message: readError.message
            });
        }
    });
});

/**
 * POST /api/path
 * Extract the movement/farming path of a single hero from a replay.
 * Body: { filePath: string, playerId: number }
 */
app.post('/api/path', (req, res) => {
    const { filePath, playerId } = req.body;

    if (!filePath) {
        return res.status(400).json({ error: 'No file path provided' });
    }
    if (playerId === undefined || playerId === null || Number.isNaN(Number(playerId))) {
        return res.status(400).json({ error: 'No valid playerId provided' });
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found', path: filePath });
    }

    console.log(`Extracting path: ${filePath}, playerId=${playerId}`);

    const tempOutputPath = path.join(IO_DIR, `path_${Date.now()}.json`);

    runGradleTask('pathRun', [filePath, Number(playerId), tempOutputPath], (error, stdout, stderr) => {
        if (error) {
            console.error('Path extraction error:', error);
            console.error('stderr:', stderr);

            if (fs.existsSync(tempOutputPath)) {
                fs.unlinkSync(tempOutputPath);
            }

            return res.status(500).json({
                error: 'Failed to extract path',
                message: error.message,
                details: stderr
            });
        }

        console.log('Path extraction output:', stdout);

        try {
            if (!fs.existsSync(tempOutputPath)) {
                throw new Error('Output file was not created');
            }

            const jsonData = fs.readFileSync(tempOutputPath, 'utf8');
            const samples = JSON.parse(jsonData);

            fs.unlinkSync(tempOutputPath);

            res.json({
                success: true,
                data: samples,
                filePath: filePath,
                playerId: Number(playerId)
            });
        } catch (readError) {
            console.error('Error reading output:', readError);

            if (fs.existsSync(tempOutputPath)) {
                fs.unlinkSync(tempOutputPath);
            }

            res.status(500).json({
                error: 'Failed to read path results',
                message: readError.message
            });
        }
    });
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        defaultDotaPath: DEFAULT_DOTA_PATH
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`====================================`);
    console.log(`🎮 Dota 2 Replay Explorer Server`);
    console.log(`====================================`);
    console.log(`Server running on: http://localhost:${PORT}`);
    console.log(`Explorer UI: http://localhost:${PORT}/dem-explorer.html`);
    console.log(`Default replay path: ${DEFAULT_DOTA_PATH}`);
    console.log(`====================================\n`);
});
