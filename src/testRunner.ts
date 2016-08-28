import chalk = require('chalk');
import diff = require('diff');
import fs = require('fs');
import glob = require('glob');
import os = require('os');
import path = require('path');
import sh = require('shelljs');
import sync from './sync';
import util = require('util');

let failures = 0;

sh.config.silent = true;
sh.cd('./test');
sh.ls().forEach(testCase => {
	const cleanup = prepare(testCase);
	run(testCase);
	failures += +assert(testCase);
	cleanup();
});

if (failures > 0) {
	console.log(chalk.red(`${failures} test cases failed`));
	process.exit(1);
}

function prepare(testCase: string) {
	sh.pushd(testCase);
	sh.rm('-rf', 'actual');
	sh.cp('-Rf', 'project', 'actual');

	return () => sh.popd();
}

function run(testCase: string) {
	withCapturedConsole('log', 'stdout.txt', () => {
		withCapturedConsole('error', 'stderr.txt', () => {
			try {
				sync({ files: `actual/locales/**.json` });
			} catch (err) {
				if (err && err.stack) {
					writeStacktrace(err);
				} else {
					console.error(err);
				}
			}
		});
	});
}

function withCapturedConsole(type: string, outFile: string, action: Function) {
	let captured = '';
	const original = console[type];
	console[type] = (...args: any[]) => captured += util.format.apply(null, args) + '\n';
	action();
	console[type] = original;
	fs.writeFileSync(`actual/${outFile}`, captured, { encoding: 'utf8' });
}

function writeStacktrace(err: Error) {
	const backslashes = /\\/g;
	const slashesFixed = err.stack.replace(backslashes, '/');
	const cwd = path.join(process.cwd(), '../../').replace(backslashes, '/');
	console.log(slashesFixed.replace(new RegExp(cwd, 'g'), ''));
}

function assert(testCase: string) {
	const name = testCase.toUpperCase();
	console.log(name + ':');
	console.log(name.replace(/./g, '-'));
	const expected = buildFlatFileMapForDirectory('expected/**/*.*');
	const actual = buildFlatFileMapForDirectory('actual/**/*.*');
	let differentFiles = 0;

	for (const filename of Object.keys(expected)) {
		const logDifferences = compareFileContents(expected[filename], actual[filename]);
		if (logDifferences) {
			console.log(filename + ' ' + chalk.bgRed('✘ Not OK'));
			logDifferences();
			differentFiles++;
		} else {
			console.log(filename + ' ' + chalk.bgGreen('✓ OK'));
		}
	}

	console.log('\n');
	return differentFiles > 0;
}

interface IFileMap { [filename: string]: string; }

function buildFlatFileMapForDirectory(pattern: string) {
	return glob.sync(pattern).reduce((fileMap, filename) => {
		const contents = (sh.cat(filename) as any).stdout as string;
		const name = filename.slice(filename.indexOf('/') + 1);
		if (path.extname(filename) === '.json') {
			const cleanedObject = JSON.parse(contents, (k, v) => typeof v === 'object' ? v : '<value>');
			fileMap[name] = JSON.stringify(cleanedObject, null, 2);
		} else {
			fileMap[name] = contents;
		}
		return fileMap;
	}, {} as IFileMap);
}

function compareFileContents(expected: string, actual: string) {
	const chunks = diff.diffLines(expected, actual);
	const filesHaveDifference = chunks.some(isChanged);

	if (filesHaveDifference) {
		return () => logDifferences(chunks);
	}

	return null;
}

function isChanged(chunk: diff.IDiffResult) {
	return chunk.added || chunk.removed;
}

function logDifferences(chunks: diff.IDiffResult[]) {
	chunks.forEach((chunk, index) => {
		let lines = chunk.value.split(/\r\n|\n/).filter(l => !!l.trim());
		const previousChunk = chunks[index - 1];
		const nextChunk = chunks[index + 1];
		const shouldCollapse = !isChanged(chunk) && lines.length > 4;

		if (shouldCollapse) {
			const head = lines.slice(0, 2);
			const tail = lines.slice(-2);
			if (previousChunk && nextChunk) {
				lines = [...head, '...', ...tail];
			} else if (previousChunk) {
				lines = [...head, '...'];
			} else if (nextChunk) {
				lines = ['...', ...tail];
			}
		}

		const color = chunk.added
			? chalk.green
			: chunk.removed
				? chalk.red
				: chalk.gray;

		console.log(color(lines.join(os.EOL)));
	});
}
