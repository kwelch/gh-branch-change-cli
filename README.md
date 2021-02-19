# GitHub Branch Renamer

> CLI tool used to rename the default branch across all a users repos

## How to use

You will need a `GITHUB_TOKEN` environment variable, you can either specify it in a `.env`. It will need `repo` scope access.

1. Clone the repo
1. run `yarn`
1. run `yarn start``
1. Follow the prompts (Use the arrows to navigate and space to select)
   Note: it will only allow you to choose repos that the default branch does not match your preferred branch name
1. Finally, confirm the request by pressing `y`
