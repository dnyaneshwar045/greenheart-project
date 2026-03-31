import { supabase } from '../lib/supabase.js'

export async function runDraw(mode = 'random') {
  const { data: subscribers } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('status', 'active')

  const { data: scores } = await supabase
    .from('scores')
    .select('score, user_id')
    .in('user_id', subscribers.map(s => s.user_id))

  let winningNumbers

  if (mode === 'random') {
    // Pick 5 random numbers 1–45
    winningNumbers = Array.from({ length: 5 }, () =>
      Math.floor(Math.random() * 45) + 1
    )
  } else {
    // Weighted: favour most frequent scores
    const freq = {}
    scores.forEach(({ score }) => freq[score] = (freq[score] || 0) + 1)
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
    winningNumbers = sorted.slice(0, 5).map(([num]) => parseInt(num))
  }

  // Match each user's scores against winning numbers
  const results = subscribers.map(({ user_id }) => {
    const userScores = scores
      .filter(s => s.user_id === user_id)
      .map(s => s.score)
    const matchCount = userScores.filter(s => winningNumbers.includes(s)).length
    return { user_id, matchCount }
  })

  return { winningNumbers, results }
}