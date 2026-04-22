export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
  
    try {
      const { prompt } = req.body
  
      if (!prompt) {
        return res.status(400).json({ error: 'Missing prompt' })
      }
  
      const apiKey = process.env.ANTHROPIC_API_KEY
  
      if (!apiKey) {
        return res.status(500).json({ error: 'API key not configured' })
      }
  
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      })
  
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Claude API error:', errorText)
        return res.status(response.status).json({
          error: 'Claude API error',
          details: errorText
        })
      }
  
      const data = await response.json()
      const text = data.content?.[0]?.text || ''
  
      return res.status(200).json({
        success: true,
        schedule: text,
        usage: data.usage
      })
  
    } catch (error) {
      console.error('Server error:', error)
      return res.status(500).json({
        error: 'Failed to generate schedule',
        details: error.message
      })
    }
  }