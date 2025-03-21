import * as core from "@actions/core";
import * as github from "@actions/github";

const parseCommaSeparatedInput = (input) => {
  return input.split(",").map((item) => item.trim());
};

const parseProjectUrl = (url) => {
  const parts = url.split("/");
  const isUserProject = parts[3] === "users";

  return {
    owner: parts[4],
    isOrg: !isUserProject,
    projectUrl: url,
  };
};

const validateIssue = (issue, TARGET_LABELS) => {
  if (!issue || !issue.node_id) {
    throw new Error("Invalid or missing issue object");
  }

  if (!issue.labels.some((label) => TARGET_LABELS.includes(label.name))) {
    throw new Error(`Issue #${issue.number} does not have a target label`);
  }

  return;
};

const fetchAllProjects = async (
  octokit,
  owner,
  isOrg,
  cursor = null,
  allProjects = []
) => {
  const query = isOrg
    ? `
    query($owner: String!, $cursor: String) {
      organization(login: $owner) {
        projectsV2(first: 100, after: $cursor) {
          nodes { id, url, number }
          pageInfo { hasNextPage, endCursor }
        }
      }
    }
  `
    : `
    query($owner: String!, $cursor: String) {
      user(login: $owner) {
        projectsV2(first: 100, after: $cursor) {
          nodes { id, url, number }
          pageInfo { hasNextPage, endCursor }
        }
      }
    }
  `;

  const result = await octokit.graphql(query, { owner, cursor });
  const projectsData = isOrg ? result.organization : result.user;
  const updatedProjects = [...allProjects, ...projectsData.projectsV2.nodes];

  if (projectsData.projectsV2.pageInfo.hasNextPage) {
    return fetchAllProjects(
      octokit,
      owner,
      isOrg,
      projectsData.projectsV2.pageInfo.endCursor,
      updatedProjects
    );
  }

  return updatedProjects;
};

const getProjectData = async (octokit, projectUrl) => {
  const {
    owner,
    isOrg,
    projectUrl: fullProjectUrl,
  } = parseProjectUrl(projectUrl);
  const allProjects = await fetchAllProjects(octokit, owner, isOrg);
  const project = allProjects.find((p) => p.url === fullProjectUrl);

  if (!project) {
    throw new Error(`Project not found: ${fullProjectUrl}`);
  }

  return project;
};

const fetchProjectItems = async (
  octokit,
  projectId,
  cursor = null,
  allItems = []
) => {
  const query = `
    query($projectId: ID!, $cursor: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100, after: $cursor) {
            nodes {
              id
              content { ... on Issue { id } }
              fieldValues(first: 8) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2SingleSelectField { name } }
                  }
                }
              }
            }
            pageInfo { hasNextPage, endCursor }
          }
        }
      }
    }
  `;

  const result = await octokit.graphql(query, { projectId, cursor });
  const updatedItems = [...allItems, ...result.node.items.nodes];

  if (result.node.items.pageInfo.hasNextPage) {
    return fetchProjectItems(
      octokit,
      projectId,
      result.node.items.pageInfo.endCursor,
      updatedItems
    );
  }

  return updatedItems;
};

const getIssueItemData = async (octokit, projectId, issueId) => {
  const allItems = await fetchProjectItems(octokit, projectId);
  return allItems.find((item) => item.content && item.content.id === issueId);
};

const addIssueToProject = async (octokit, projectId, issueId) => {
  const mutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `;

  const result = await octokit.graphql(mutation, {
    projectId,
    contentId: issueId,
  });

  return result.addProjectV2ItemById.item;
};

const getStatusField = async (octokit, projectId) => {
  const query = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id, name }
              }
            }
          }
        }
      }
    }
  `;

  const result = await octokit.graphql(query, { projectId });

  return result.node.fields.nodes.find((field) => field.name === "Status");
};

const getCurrentStatus = (issueItemData) => {
  return issueItemData.fieldValues?.nodes.find(
    (node) => node.field?.name === "Status"
  )?.name;
};

const updateIssueStatus = async (
  octokit,
  projectId,
  itemId,
  statusFieldId,
  statusOptionId
) => {
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $statusFieldId: ID!, $statusOptionId: String!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $statusFieldId
          value: { singleSelectOptionId: $statusOptionId }
        }
      ) {
        projectV2Item { id }
      }
    }
  `;

  await octokit.graphql(mutation, {
    projectId,
    itemId,
    statusFieldId,
    statusOptionId,
  });
};

const getTargetStatusOption = (statusField, TARGET_COLUMN) => {
  const targetStatusOption = statusField.options.find(
    (option) => option.name === TARGET_COLUMN
  );

  if (!targetStatusOption) {
    throw new Error(`Target status "${TARGET_COLUMN}" not found in project`);
  }

  return targetStatusOption;
};

const processIssueItem = async (
  octokit,
  projectData,
  issue,
  TARGET_COLUMN,
  IGNORED_COLUMNS,
  SKIP_IF_NOT_IN_PROJECT
) => {
  const statusField = await getStatusField(octokit, projectData.id);
  const targetStatusOption = getTargetStatusOption(statusField, TARGET_COLUMN);

  if (!targetStatusOption) {
    return;
  }

  let issueItemData = await getIssueItemData(
    octokit,
    projectData.id,
    issue.node_id
  );

  if (!issueItemData) {
    if (SKIP_IF_NOT_IN_PROJECT) {
      console.log(
        `Issue #${issue.number} is not in the project. Skipping due to skip-if-not-in-project flag.`
      );
      return;
    }

    issueItemData = await addIssueToProject(
      octokit,
      projectData.id,
      issue.node_id
    );
    console.log(`Added issue #${issue.number} to the project.`);
  }

  const currentStatus = getCurrentStatus(issueItemData);

  if (IGNORED_COLUMNS.includes(currentStatus)) {
    console.log(
      `Issue #${issue.number} is in an ignored column (${currentStatus}). Skipping.`
    );
    return;
  }

  await updateIssueStatus(
    octokit,
    projectData.id,
    issueItemData.id,
    statusField.id,
    targetStatusOption.id
  );
  console.log(`Moved issue #${issue.number} to "${TARGET_COLUMN}"`);
};

const handleLabeledEvent = async (
  octokit,
  issue,
  projectData,
  TARGET_COLUMN,
  IGNORED_COLUMNS,
  TARGET_LABELS,
  SKIP_IF_NOT_IN_PROJECT
) => {
  validateIssue(issue, TARGET_LABELS);

  await processIssueItem(
    octokit,
    projectData,
    issue,
    TARGET_COLUMN,
    IGNORED_COLUMNS,
    SKIP_IF_NOT_IN_PROJECT
  );
};

const handleUnlabeledEvent = async (
  octokit,
  issue,
  projectData,
  DEFAULT_COLUMN,
  IGNORED_COLUMNS,
  TARGET_LABELS
) => {
  const removedLabel = github.context.payload.label.name;
  if (!TARGET_LABELS.includes(removedLabel)) {
    return;
  }

  const hasTargetLabel = issue.labels.some((label) =>
    TARGET_LABELS.includes(label.name)
  );

  if (hasTargetLabel) {
    console.log(
      `Issue #${issue.number} still has a target label. Not moving to default column.`
    );
    return;
  }

  await moveIssueToDefaultColumn(
    octokit,
    projectData,
    issue,
    DEFAULT_COLUMN,
    IGNORED_COLUMNS
  );
};

const moveIssueToDefaultColumn = async (
  octokit,
  projectData,
  issue,
  defaultColumn,
  ignoredColumns
) => {
  const statusField = await getStatusField(octokit, projectData.id);
  const defaultStatusOption = getTargetStatusOption(statusField, defaultColumn);

  if (!defaultStatusOption) {
    throw new Error(`Default column "${defaultColumn}" not found in project`);
  }

  let issueItemData = await getIssueItemData(
    octokit,
    projectData.id,
    issue.node_id
  );

  if (!issueItemData) {
    console.log(`Issue #${issue.number} is not in the project. Skipping.`);
    return;
  }

  const currentStatus = getCurrentStatus(issueItemData);

  if (ignoredColumns.includes(currentStatus)) {
    console.log(
      `Issue #${issue.number} is in an ignored column (${currentStatus}). Skipping.`
    );
    return;
  }

  await updateIssueStatus(
    octokit,
    projectData.id,
    issueItemData.id,
    statusField.id,
    defaultStatusOption.id
  );
  console.log(`Moved issue #${issue.number} back to "${defaultColumn}"`);
};

const run = async () => {
  try {
    const token = core.getInput("github-token");
    const projectUrl = core.getInput("project-url");
    const targetLabels = core.getInput("target-labels");
    const targetColumn = core.getInput("target-column");
    const ignoredColumns = core.getInput("ignored-columns");
    const defaultColumn = core.getInput("default-column", { required: false });
    const issueNumberParam = core.getInput("issue-number", { required: false });

    const TARGET_COLUMN = targetColumn.trim();
    const TARGET_LABELS = parseCommaSeparatedInput(targetLabels);
    const IGNORED_COLUMNS = parseCommaSeparatedInput(ignoredColumns);
    const DEFAULT_COLUMN = defaultColumn ? defaultColumn.trim() : null;
    const ISSUE_NUMBER_PARAM = issueNumberParam ? issueNumberParam.trim() : null;

    const SKIP_IF_NOT_IN_PROJECT =
      core.getInput("skip-if-not-in-project") === "true";

    const octokit = github.getOctokit(token);

    core.debug("Determing issue number...");
    const issueNumber = ISSUE_NUMBER_PARAM ? ISSUE_NUMBER_PARAM : github.context.issue.number;
    core.debug("Issue number: " + issueNumber);

    // The issue might have been updated by a previous GitHub action; therefore, we refetch the issue data
    const { owner, repo } = github.context.repo;
    core.debug("owner: " + owner + " repo: " + repo);
    const { data: updatedIssue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    core.debug("Udpated issue " + updatedIssue);
    const issue = updatedIssue;
    core.debug("Issue " + issue);

    if (!issue || !issue.node_id) {
      throw new Error("Invalid or missing issue object");
    }

    const eventName = github.context.eventName;
    const action = github.context.payload.action;
    const projectData = await getProjectData(octokit, projectUrl);

    core.debug("Event: " + eventName);

    if ((eventName === "issue_comment") || (eventName === "pull_request") || (eventName === "pull_request_target") || ISSUE_NUMBER_PARAM) {
      core.debug("Hit issue or PR");

      const hasTargetLabel = issue.labels.some((label) =>
        TARGET_LABELS.includes(label.name)
      );
      if (hasTargetLabel) {
        // Proceed as if the label was added to the issue
        await processIssueItem(
          octokit,
          projectData,
          issue,
          TARGET_COLUMN,
          IGNORED_COLUMNS,
          SKIP_IF_NOT_IN_PROJECT
        );
      } else {
        // Proceed as if the label was removed from the issue
        await moveIssueToDefaultColumn(
          octokit,
          projectData,
          issue,
          DEFAULT_COLUMN,
          IGNORED_COLUMNS
        );
      }
      return;
    }

    if (action === "labeled") {
      core.debug("Hit labeled");

      await handleLabeledEvent(
        octokit,
        issue,
        projectData,
        TARGET_COLUMN,
        IGNORED_COLUMNS,
        TARGET_LABELS,
        SKIP_IF_NOT_IN_PROJECT
      );
      return;
    }

    if (action === "unlabeled" && DEFAULT_COLUMN) {
      core.debug("Hit unlabeled");

      await handleUnlabeledEvent(
        octokit,
        issue,
        projectData,
        DEFAULT_COLUMN,
        IGNORED_COLUMNS,
        TARGET_LABELS
      );
      return;
    }

    console.log(`No action taken for ${eventName}/${action} event.`);
  } catch (error) {
    core.setFailed(`Error processing issue: ${error.message}`);
  }
};

run();
