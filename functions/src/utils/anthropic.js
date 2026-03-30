import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function callClaude({ system, userMessage, schema, maxTokens = 1000 }) {
  const systemWithSchema = schema
    ? `${system}\n\nYou must respond ONLY with valid JSON matching this schema:\n${schema}\nNo markdown fences, no explanation, just the JSON object.`
    : system

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemWithSchema,
    messages: [{ role: 'user', content: userMessage }]
  })

  return message.content[0].type === 'text' ? message.content[0].text : ''
}
