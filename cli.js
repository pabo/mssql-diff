#!/usr/bin/env node

const sql = require('mssql');
const deepDiff = require('deep-diff');
const readline = require('readline');

const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

const argv = yargs(hideBin(process.argv))
  .option('server', {
    alias: 'S',
    type: 'string',
    default: 'localhost,1433',
    description: 'mssql server'
  })
  .option('user', {
    alias: 'U',
    type: 'string',
    description: 'mssql user',
    demandOption: true
  })
  .option('password', {
    alias: 'P',
    type: 'string',
    description: 'mssql password',
    demandOption: true
  })
  .option('database', {
    alias: 'd',
    type: 'string',
    description: 'mssql database',
    demandOption: true
  })
  .option('tenant', {
    alias: 't',
    type: 'string',
    description: 'tenant name'
  })
  .option('filter', {
    alias: 'f',
    type: 'boolean',
    default: true,
    description: 'filter out dupes and boilerplate'
  })
  .option('summarize', {
    alias: 'm',
    type: 'boolean',
    default: true,
    description: 'summarize output to make it clearer'
  })
  .parse();


const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
 });


const getAllTableNames = async () => {
        return sql.query(`
		SELECT
			TABLE_NAME
		FROM
			INFORMATION_SCHEMA.TABLES
		WHERE
			TABLE_CATALOG = '${argv.database}'
			AND TABLE_TYPE = 'BASE TABLE'
		ORDER BY
			TABLE_NAME`);
}

const connect = async () => {
        await sql.connect(`Server=${argv.server};Database=${argv.database};User Id=${argv.user};Password=${argv.password};Encrypt=false;`)
	return;
}

const tableSnapshot = async (tableName) => {
	const fullTableName = argv.tenant ? `[${argv.tenant}].[${tableName}]` : tableName;
        return sql.query(`select * from ${fullTableName}`);
}

const dbSnapshot = async (tables) => {
	const dbSnapshot = {};

	await Promise.all(tables.recordset
		.map(tableRecord => tableRecord.TABLE_NAME)
		.filter(tableName => tableName !== '__UpgradeSyncRoot__')
		.map(async tableName => {
			dbSnapshot[tableName] = await tableSnapshot(tableName)
		})
	);

	return dbSnapshot;
}

const collapsePath = path => {
	const collapsedPath = path.filter(p => p !== 'recordset').join(".");
	return collapsedPath.replace("recordsets.0.", "");
}

const summarizeDiff = (diff) => {
	const {kind, path, lhs, rhs, item} = diff;

	if (!argv.summarize) {
		return {
			...diff,
			path: collapsePath(path),
		};
	}


	if (kind === 'E') {
		return {
			kind: "Edit",
			path: collapsePath(path),
			old: lhs,
			new: rhs,
		};
	}

	if (kind === 'A') {
		return {
			kind: "Add",
			path: collapsePath(path),
			new: item.rhs
		};
	}

	if (kind === 'D') {
		return {
			kind: "Delete",
			path: collapsePath(path),
			old: item.lhs
		};
	}

	// TODO: support top level 'N' if it exists?
	throw new Error("kind was not A, D, or E");
}

/*
 * `recordsets.0` is duplicate of what was in `recordset`, so we just filter these out.
 * `{path}.rowsAffected.0` is inferrable from the existance of an Add to {path}.
 * `BillingChangeEvent*` is an audit trail that I'm generally not concerned with.
 *
 */
const filters = (diff) => {
	if (!argv.filter) {
		return true;
	}

	return (
		!diff.path.endsWith("recordsets.0")
		&& !diff.path.endsWith("rowsAffected.0")
		&& !diff.path.startsWith("BillingChangeEvent")
	);
}

// no top-level await, so we wrap in a function
const go = async () => {
	try {
		await connect();
		const tables = await getAllTableNames();
		const before = await dbSnapshot(tables);
		console.log("First db snapshot taken. Take some action in the app that will affect the database before taking the next snapshot.")

		rl.question("[Enter] to take next snapshot...", async function() {
			const after = await dbSnapshot(tables);
			const diff = deepDiff.diff(before, after).map(summarizeDiff).filter(filters);
			console.log(diff);

			process.exit(0);
		});
	}
	catch(error) {
		console.log(error);
		process.exit(1);
	}
}

go();
