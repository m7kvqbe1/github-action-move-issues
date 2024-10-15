# Move Issue to Project Column

A GitHub Action to move issues between GitHub Projects V2 columns based on specific labels and criteria.

## Inputs

| Input             | Description                                                                                        | Required |
| ----------------- | -------------------------------------------------------------------------------------------------- | -------- |
| `github-token`    | Create a Personal Access Token (Classic) with the `public_repo` and `project` scopes.              | Yes      |
| `project-url`     | The URL of the GitHub Project V2.                                                                  | Yes      |
| `target-labels`   | Comma-separated list of labels that should trigger the action (e.g., "Size: Small, Size: Medium"). | Yes      |
| `target-column`   | The target column name to move the issue to (e.g., "Candidates for Ready").                        | Yes      |
| `ignored-columns` | Comma-separated list of column names to ignore (e.g., "Ready, In Progress, In Review, Done").      | Yes      |

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
        uses: m7kvqbe1/github-action-move-issues@{release}
        with:
          github-token: ${{ secrets.PAT_TOKEN }}
          project-url: "https://github.com/orgs/your-org/projects/1"
          target-labels: "Size: Small, Size: Medium"
          target-column: "Candidates for Ready"
          ignored-columns: "Ready, In Progress, In Review, Done"
```

Get the latest `{release}` tag from https://github.com/m7kvqbe1/github-action-move-issues/releases.
