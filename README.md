# Move Issue to Project Column

A GitHub Action to move issues between GitHub Projects V2 columns based on specific labels and criteria. It can handle both labeling and unlabeling events.

## Inputs

| Input                    | Description                                                                                                              | Required |
|--------------------------|--------------------------------------------------------------------------------------------------------------------------|----------|
| `github-token`           | Create a Personal Access Token (Classic) with the `public_repo` and `project` scopes.                                    | Yes      |
| `project-url`            | The URL of the GitHub Project V2.                                                                                        | Yes      |
| `target-labels`          | Comma-separated list of labels that should trigger the action (e.g., "Size: Small, Size: Medium").                       | Yes      |
| `target-column`          | The target column name to move the issue to when labeled (e.g., "Candidates for Ready").                                 | Yes      |
| `ignored-columns`        | Comma-separated list of column names to ignore (e.g., "Ready, In Progress, In Review, Done").                            | Yes      |
| `default-column`         | The column to move the issue to when a target label is removed. If not specified, no action will be taken on unlabeling. | No       |
| `skip-if-not-in-project` | Skip moving the issue if it is not already in the project (default: `false`)                                             | No       |

## Example Workflow

```yaml
name: Move Issue on Label Change

on:
  issues:
    types: [labeled, unlabeled]

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
          default-column: "To Do" # Optional: Remove this line if you don't want issues moved when labels are removed
```

Get the latest `{release}` tag from https://github.com/m7kvqbe1/github-action-move-issues/releases.

## Behavior

- When an issue is labeled with one of the target labels, it will be moved to the specified target column.
- When all target labels are removed from an issue:
  - If a default column is specified, the issue will be moved to that column.
  - If no default column is specified, no action will be taken.
- The action will not move issues that are already in one of the ignored columns.
