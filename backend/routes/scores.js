import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.post('/', requireAuth, async (req, res) => {
  const { score, played_on } = req.body
  const userId = req.user.id

  // Get existing scores ordered oldest first
  const { data: existing } = await supabase
    .from('scores')
    .select('id')
    .eq('user_id', userId)
    .order('played_on', { ascending: true })

  // Drop oldest if already at 5
  if (existing.length >= 5) {
    await supabase.from('scores').delete().eq('id', existing[0].id)
  }

  const { data, error } = await supabase
    .from('scores')
    .insert({ user_id: userId, score, played_on })

  if (error) return res.status(400).json({ error })
  res.json({ data })
})

router.get('/', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('scores')
    .select('*')
    .eq('user_id', req.user.id)
    .order('played_on', { ascending: false })
  res.json({ data })
})

export default router