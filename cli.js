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
  .option('tables', {
    alias: 'b',
    type: 'string',
    description: 'only snapshot these tables'
  })
  .option('order-by-column', {
    alias: 'o',
    type: 'string',
    description: 'ORDER BY this column to guarantee result order which should minimize diffs. Any table not containing this column will be silently ignored.'
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
        const result = await sql.query(`
		SELECT
			TABLE_NAME
		FROM
			INFORMATION_SCHEMA.TABLES
		WHERE
			TABLE_CATALOG = '${argv.database}'
			AND TABLE_TYPE = 'BASE TABLE'
		ORDER BY
			TABLE_NAME`);

	return result.recordset
		.map(tableRecord => tableRecord.TABLE_NAME)
		.filter(tableName => tableName !== '__UpgradeSyncRoot__');
}

const connect = async () => {
        await sql.connect(`Server=${argv.server};Database=${argv.database};User Id=${argv.user};Password=${argv.password};Encrypt=false;`)
	return;
}

const tableSnapshot = async (tableName) => {
	const orderByClause = argv['order-by-column'] ? `ORDER BY ${argv['order-by-column']}` : '';

	try {
		const fullTableName = argv.tenant ? `[${argv.tenant}].[${tableName}]` : tableName;
        	const results = await sql.query(`select * from ${fullTableName} ${orderByClause}`);
		return results;
	}
	catch (error) {
		return null;
	}
}

const dbSnapshot = async (tables) => {
	const dbSnapshot = {};

	await Promise.all(tables.map(async tableName => {
		dbSnapshot[tableName] = await tableSnapshot(tableName)
	}));

	return dbSnapshot;
}

const collapsePath = path => {
	const collapsedPath = path.filter(p => p !== 'recordset').join(".");
	return collapsedPath.replace(".recordsets.0", "");
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
		!diff.path.includes("recordsets")
		&& !diff.path.includes("rowsAffected")
		&& !diff.path.includes("BillingChangeEvent") // TODO: make this an option
	);
}

// turn ["a", "b", "c,d,e", "f"] into ["a", "b", "c", "d", "e", "f"]
const collapseArray = (array) => {
	const result = [];

	const tables = (typeof array === 'string') ? Array(array) : array;
	tables.forEach(table => {
		table.split(",").forEach(t => {
			result.push(t)	
		});
	})

	return result;
}

const getUsableTableNames = async () => {
	const allTableNames = await getAllTableNames();

	let tables = [];

	if (argv.tables) {
		collapseArray(argv.tables).forEach(t => {
			// verify that the asked-for tables exist in the db
			if (allTableNames.includes(t)) {
				tables.push(t);
				return;
			}

			console.warn(`Table ${t} not found in database. Skipping...`);
		})
	}
	else {
		tables = allTableNames;
	}

	if (tables.length === 0) {
		// give up if no asked-for tables exist in the db
		console.error("No tables to be diffed. Exiting...");
		process.exit(0);
	}

	return tables;
}

// no top-level await, so we wrap in a function
const go = async () => {
	try {
		await connect();
		const tables = await getUsableTableNames();
		const before = await dbSnapshot(tables);

		console.log("First db snapshot taken. Take some action in the app that will affect the database before taking the next snapshot.")

		rl.question("\n[Enter] to take next snapshot...\n", async function() {
			const after = await dbSnapshot(tables);
			const diff = deepDiff.diff(before, after)?.filter(filters).map(summarizeDiff);
			console.log(diff || "No diff!");

			process.exit(0);
		});
	}
	catch(error) {
		console.log(error);
		process.exit(1);
	}
}

go();
