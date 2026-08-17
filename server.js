const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
 * POST /api/parse-replay
 * Parse a .dem file and return match information
 * Body: { filePath: string }
 */
app.post('/api/parse-replay', async (req, res) => {
    const { filePath } = req.body;

    if (!filePath) {
        return res.status(400).json({ error: 'No file path provided' });
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found', path: filePath });
    }

    console.log(`Parsing replay: ${filePath}`);

    // Create temporary output file
    const tempOutputPath = path.join(os.tmpdir(), `match_${Date.now()}.json`);

    // Build gradle command
    const gradlewCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    const command = `${gradlewCmd} matchinfoRun --args="${filePath} ${tempOutputPath}"`;

    console.log(`Executing: ${command}`);

    exec(command, {
        cwd: __dirname,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    }, (error, stdout, stderr) => {
        if (error) {
            console.error('Parsing error:', error);
            console.error('stderr:', stderr);

            // Clean up temp file if it exists
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

        // Read the generated JSON file
        try {
            if (!fs.existsSync(tempOutputPath)) {
                throw new Error('Output file was not created');
            }

            const jsonData = fs.readFileSync(tempOutputPath, 'utf8');
            const matchData = JSON.parse(jsonData);

            // Clean up temp file
            fs.unlinkSync(tempOutputPath);

            res.json({
                success: true,
                data: matchData,
                filePath: filePath
            });
        } catch (readError) {
            console.error('Error reading output:', readError);

            // Clean up temp file if it exists
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
