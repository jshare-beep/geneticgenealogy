// Cloud save + sign-in via Supabase, reached directly from the browser through its CDN
// ESM client - no bundler needed. Shares the SAME Supabase project/credentials as the
// Multifacet app one level up (../../supabase/config.js) so there's only one project to
// set up, just a second table (`genealogy_maps` - see ../../supabase/schema_genealogy_mapper.sql)
// alongside Multifacet's own `trees` table. Gracefully falls back to "not configured"
// (callers fall back to local-only save) until that config.js exists with real values.

let clientPromise = null;

async function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    let config;
    try {
      config = await import('../../../supabase/config.js');
    } catch {
      return null;
    }
    if (!config.SUPABASE_URL || config.SUPABASE_URL.includes('YOUR-PROJECT')) return null;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  })();
  return clientPromise;
}

export async function isCloudConfigured() {
  return (await getClient()) !== null;
}

export async function getSession() {
  const client = await getClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

export async function onAuthChange(callback) {
  const client = await getClient();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmail(email) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sign-in is not configured yet.');
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
  if (error) throw error;
}

export async function signInWithGoogle() {
  const client = await getClient();
  if (!client) throw new Error('Cloud sign-in is not configured yet.');
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
  if (error) throw error;
}

export async function signOut() {
  const client = await getClient();
  if (!client) return;
  await client.auth.signOut();
}

export async function listMyMaps() {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { data, error } = await client.from('genealogy_maps').select('id, name, updated_at').order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({ id: row.id, name: row.name, updatedAt: row.updated_at }));
}

export async function loadMap(id) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { data, error } = await client.from('genealogy_maps').select('data').eq('id', id).single();
  if (error) throw error;
  return data.data;
}

export async function createMap(userId, name, treeData) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { data, error } = await client.from('genealogy_maps').insert({ user_id: userId, name, data: treeData }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateMap(id, name, treeData) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { error } = await client
    .from('genealogy_maps')
    .update({ name, data: treeData, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteMap(id) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { error } = await client.from('genealogy_maps').delete().eq('id', id);
  if (error) throw error;
}
