export function getLastAssistantMessage(conversation) {
  if (!conversation?.messages?.length) {
    return null;
  }

  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === 'assistant') {
      return message;
    }
  }

  return null;
}

export function getFollowUpCouncilModels(conversation, localModels = []) {
  const availableNames = new Set(localModels.map((model) => model.name));
  const lastAssistant = getLastAssistantMessage(conversation);
  const previousCouncil = (lastAssistant?.stage1 || [])
    .map((entry) => entry.model)
    .filter((model) => availableNames.has(model));

  if (previousCouncil.length >= 2) {
    return previousCouncil;
  }

  return localModels.slice(0, Math.min(3, localModels.length)).map((model) => model.name);
}

export function getFollowUpComposerState(conversation, localModels = []) {
  const councilModels = getFollowUpCouncilModels(conversation, localModels);
  const installedModelNames = localModels.map((model) => model.name);
  const canSend = councilModels.length >= 2;

  let message = `Continuing with: ${councilModels.join(', ')}`;
  if (!canSend) {
    const detected = installedModelNames.length > 0 ? installedModelNames.join(', ') : 'none';
    message = `Auto follow-up needs at least 2 installed local models. Detected: ${detected}.`;
  }

  return {
    councilModels,
    canSend,
    message,
  };
}
