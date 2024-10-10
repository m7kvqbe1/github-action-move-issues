const core = require("@actions/core");
const github = require("@actions/github");

const parseCommaSeparatedInput = (input) => {
  return input.split(",").map((item) => item.trim());
};

const validateIssue = (issue, TARGET_LABELS, core) => {
  if (!issue || !issue.node_id) {
    core.setFailed("Invalid or missing issue object");
    return false;
  }

  if (!issue.labels.some((label) => TARGET_LABELS.includes(label.name))) {
    console.log(`Issue #${issue.number} does not have a target label`);
    return false;
  }

  return true;
};

const parseProjectUrl = (url) => {
  const parts = url.split("/");
  return {
    orgName: parts[parts.length - 3],
    projectUrl: url,
  };
};

const fetchAllProjects = async (
  octokit,
  orgName,
  cursor = null,
  allProjects = []
) => {
  const query = `
    query($orgName: String!, $cursor: String) {
      organization(login: $orgName) {
        projectsV2(first: 100, after: $cursor) {
          nodes { id, url, number }
          pageInfo { hasNextPage, endCursor }
        }
      }
    }
  `;

  const result = await octokit.graphql(query, { orgName, cursor });
  const updatedProjects = [
    ...allProjects,
    ...result.organization.projectsV2.nodes,
  ];

  if (result.organization.projectsV2.pageInfo.hasNextPage) {
    return fetchAllProjects(
      octokit,
      orgName,
      result.organization.projectsV2.pageInfo.endCursor,
      updatedProjects
    );
  }

  return updatedProjects;
};

const getProjectData = async (octokit, projectUrl) => {
  const { orgName, projectUrl: fullProjectUrl } = parseProjectUrl(projectUrl);
  const allProjects = await fetchAllProjects(octokit, orgName);
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

const getTargetStatusOption = (statusField, TARGET_COLUMN, core) => {
  const targetStatusOption = statusField.options.find(
    (option) => option.name === TARGET_COLUMN
  );

  if (!targetStatusOption) {
    core.setFailed(`Target status "${TARGET_COLUMN}" not found in project`);
    return null;
  }

  return targetStatusOption;
};

const processIssueItem = async (
  octokit,
  projectData,
  issue,
  TARGET_COLUMN,
  IGNORED_COLUMNS,
  core
) => {
  const statusField = await getStatusField(octokit, projectData.id);
  const targetStatusOption = getTargetStatusOption(
    statusField,
    TARGET_COLUMN,
    core
  );

  if (!targetStatusOption) {
    return;
  }

  let issueItemData = await getIssueItemData(
    octokit,
    projectData.id,
    issue.node_id
  );

  if (!issueItemData) {
    issueItemData = await addIssueToProject(
      octokit,
      projectData.id,
      issue.node_id
    );
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

const run = async () => {
  try {
    const token = core.getInput("github-token");
    const projectUrl = core.getInput("project-url");
    const targetLabelsInput = core.getInput("target-labels");
    const targetColumn = core.getInput("target-column");
    const ignoredColumnsInput = core.getInput("ignored-columns");

    const TARGET_COLUMN = targetColumn.trim();
    const TARGET_LABELS = parseCommaSeparatedInput(targetLabelsInput);
    const IGNORED_COLUMNS = parseCommaSeparatedInput(ignoredColumnsInput);

    const octokit = github.getOctokit(token);
    const issue = github.context.payload.issue;

    if (!validateIssue(issue, TARGET_LABELS, core)) {
      return;
    }

    const projectData = await getProjectData(octokit, projectUrl);
    await processIssueItem(
      octokit,
      projectData,
      issue,
      TARGET_COLUMN,
      IGNORED_COLUMNS,
      core
    );
  } catch (error) {
    core.setFailed(`Error moving issue: ${error.message}`);
  }
};

run();
