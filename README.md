# Move Issue to Project Column

A GitHub Action to move issues between GitHub Projects V2 columns based on specific labels and criteria.

## Inputs

- `github-token`: **Required**. You will need to create a PAT (Personal Access Token) with the `repo` and `admin:org` scopes.
- `project-url`: **Required**. The URL of the GitHub Project V2.
- `target-labels`: **Required**. Comma-separated list of labels that should trigger the action (e.g., "Size: Small, Size: Medium").
- `target-column`: **Required**. The target column name to move the issue to (e.g., "Candidates for Ready").
- `ignored-columns`: **Required**. Comma-separated list of column names to ignore (e.g., "Ready, In Progress, In Review, Done").

## Example Workflow

```yaml
name: Move Issue on Label

on:
  issues:
    types: [labeled]

jobs:
  move-issue:
    runs-on: ubuntu-latest
    steps:
      - name: Move Issue to Project Column
        uses: your-username/github-action-move-issues@v1.0.0
        with:
          github-token: ${{ secrets.PAT_TOKEN }}
          project-url: "https://github.com/orgs/your-org/projects/1"
          target-labels: "Size: Small, Size: Medium"
          target-column: "Candidates for Ready"
          ignored-columns: "Ready, In Progress, In Review, Done"
```
