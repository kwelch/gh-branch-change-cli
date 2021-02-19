#!/usr/bin/env node
require("dotenv").config();

const { execSync } = require("child_process");
const meow = require("meow");
const chalk = require("chalk");
const { Octokit } = require("@octokit/rest");
const { prompt } = require("enquirer");
const logger = require("loglevel");
const termSize = require("term-size");
const clear = require("clear");
logger.setDefaultLevel("info");
logger.setLevel(process.env.LOG_LEVEL || "info");

let cancelFlow = () => {
	logger.info("Cancelled... 👋 ");
	process.exit();
};

//TODO: consider move to use app auth
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const cli = meow(
	`
	Usage
		$ fix-default-branches [branch name]

	Defaults:
		Branch Name - defaults to vaulue from 'git config init.defaultBranch'

	Examples:
		$ fix-default-branches main
`,
	{
		flags: {
			verbose: {
				type: "boolean",
				alias: "v",
				default: false,
			},

			silent: {
				type: "boolean",
				alias: "s",
				default: false,
			},
		},
	}
);

function getDefaultBranchFromConfig() {
	try {
		return execSync("git config init.defaultBranch", {
			encoding: "utf-8",
		}).trim();
	} catch (err) {
		return null;
	}
}

async function askQuestion({
	type,
	name,
	message,
	multiple,
	limit = Math.max(termSize().rows - 5, 10),
	choices,
}) {
	return prompt({
		type,
		name,
		message,
		multiple,
		limit,
		choices,
		onCancel: cancelFlow,
	}).then((responses) => responses[name]);
}

async function askQuestionUntilAnswered(questionOptions) {
	let answer = await askQuestion(questionOptions);

	if (answer.length === 0) {
		do {
			clear();
			logger.error(chalk.red("You must select at least one repo to update"));
			logger.warn(chalk.dim("(You most likely hit enter instead of space!)"));

			answer = await askQuestion(questionOptions);
		} while (answer.length === 0);
	}
	return answer;
}

async function main(
	[preferredBranchName = getDefaultBranchFromConfig()],
	{ verbose, silent }
) {
	if (verbose) {
		logger.enableAll();
		logger.debug(chalk.green("Enabling trace level logging..."));
	}
	if (silent) {
		logger.disableAll();
	}
	if (!preferredBranchName) {
		logger.error(chalk.red("Missing argument 'branch name'"));
		logger.error(chalk`Usage: {dim fix-default-branches [branch name]}`);
		logger.error("");
		logger.info(
			chalk.blue("Also, you can set the default branch globally by running:")
		);
		logger.info(
			chalk.dim("  $ git config --global init.defaultBranch <branch name>")
		);
		logger.info("");
		return 1;
	}
	const userRepos = await octokit.paginate(
		octokit.repos.listForAuthenticatedUser
	);

	logger.debug(chalk`You have {bold ${userRepos.length}} total repos`);

	// the goal of this reduce is to filter out repos, we don't care about and conver the output from an array of repos to a look up of repos, with less data
	const repoWithInvalidDefaultBranch = userRepos.reduce(
		(accumulator, currentItem) => {
			// if the default is already perferred, return the list (essentially continung to the next item)
			if (currentItem.default_branch === preferredBranchName) {
				return accumulator;
			}

			// if we make it here we want the item in the list so we are going to do some clean up
			return {
				// spread the accumulator, so we don't loose previous items
				...accumulator,
				// key the loopup by the full name
				// this will help us prompt the user with a familar name
				// and make it easy to pull this data again
				[currentItem.full_name]: {
					id: currentItem.id,
					full_name: currentItem.full_name,
					owner: currentItem.owner,
					name: currentItem.name,
					default_branch: currentItem.default_branch,
				},
			};
		},
		{}
	);
	logger.debug(
		chalk`You have {bold ${
			Object.keys(repoWithInvalidDefaultBranch).length
		}} repos that could be updated`
	);

	const repoUpdateList = await askQuestionUntilAnswered({
		type: "autocomplete",
		name: "repoUpdateList",
		message: "Which repo should be updated?",
		multiple: true,
		choices: Object.keys(repoWithInvalidDefaultBranch),
	});
	const sure = await askQuestion({
		type: "confirm",
		name: "sure",
		message:
			"Are you sure you want to change the default branch? \nThis will rename the branch and update all PRs targeting that branch",
		default: false,
	});

	// not a great variable name, but does make this if statment hilarious
	if (!sure) {
		cancelFlow();
	}

	logger.debug(repoUpdateList);
	const renamePromises = [];

	for (const repoName of repoUpdateList) {
		const repoDetails = repoWithInvalidDefaultBranch[repoName];

		logger.debug({
			owner: repoDetails.owner.login,
			repo: repoDetails.name,
			branch: repoDetails.default_branch,
			new_name: preferredBranchName,
		});

		renamePromises.push(
			octokit.repos
				.renameBranch({
					owner: repoDetails.owner.login,
					repo: repoDetails.name,
					branch: repoDetails.default_branch,
					new_name: preferredBranchName,
				})
				.catch((err) => {
					logger.error(
						chalk.red.italic(`Unable to update default branch for ${repoName}`)
					);
					logger.debug(err);
				})
		);
	}

	await Promise.all(renamePromises);

	logger.log(
		"Update complete. Please give it a moment to completely take effect."
	);
}

main(cli.input, cli.flags).then(
	(exitCode) => {
		return exitCode;
	},
	(err) => {
		logger.error(chalk.red("Interal Error occured"));
		logger.error(err.message);
		logger.warn(
			chalk.yellow(
				"To view more deatils on this error, pass the --verbose flag"
			)
		);
		logger.debug(err);

		process.exit(1);
	}
);
