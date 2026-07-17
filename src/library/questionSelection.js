export function sortByQuestionOrder(a, b) {
  return Number(a.order || 0) - Number(b.order || 0)
}

function questionSetVersion(question) {
  return typeof question?.questionSetVersion === 'string'
    ? question.questionSetVersion.trim()
    : ''
}

function latestRoleQuestions(roleQuestions) {
  const versionedQuestions = roleQuestions.filter(q => questionSetVersion(q))
  if (versionedQuestions.length === 0) return [...roleQuestions].sort(sortByQuestionOrder)

  const latestVersion = [...new Set(versionedQuestions.map(questionSetVersion))].sort().at(-1)
  return roleQuestions
    .filter(q => questionSetVersion(q) === latestVersion)
    .sort(sortByQuestionOrder)
}

export function selectQuestionsForRole(allQuestions, roleKey) {
  const activeQuestions = (allQuestions || []).filter(q => q?.active !== false)
  const roleQuestions = latestRoleQuestions(activeQuestions.filter(q => q.roleKey === roleKey))
  const standaloneRoleBattery = roleQuestions.some(q => q.standaloneRoleBattery === true)

  if (standaloneRoleBattery) return roleQuestions

  return [
    ...activeQuestions.filter(q => q.roleKey === 'all').sort(sortByQuestionOrder),
    ...roleQuestions,
  ].sort(sortByQuestionOrder)
}

export function questionsFromStoredMap(questionMap) {
  return Object.entries(questionMap || {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([index, question]) => {
      if (!question || typeof question !== 'object' || !question.text || !question.type) return null

      return {
        id: question.questionId || question.id || `stored-${index}`,
        questionId: question.questionId || question.id || null,
        text: question.text,
        type: question.type,
        category: question.category || 'situational',
        roleKey: question.roleKey || 'stored',
        order: Number.isFinite(Number(question.order)) ? Number(question.order) : Number(index),
        active: question.active !== false,
        timerType: question.timerType || 'none',
        timerSeconds: Number(question.timerSeconds || 0),
        questionSetVersion: question.questionSetVersion || null,
        fromStoredQuestionMap: true,
      }
    })
    .filter(Boolean)
}
