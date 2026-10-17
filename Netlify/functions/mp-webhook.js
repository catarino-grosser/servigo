// Recebe avisos do Mercado Pago e sincroniza o status da assinatura no Firestore.
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const ok = { statusCode: 200, body: "ok" };

exports.handler = async (e) => {
  let b = {}; try { b = JSON.parse(e.body || "{}"); } catch (x) {}
  const q = e.queryStringParameters || {};
  const type = String(b.type || b.topic || q.type || q.topic || "");
  const id = (b.data && b.data.id) || q["data.id"] || q.id;
  if (!id || !/^(subscription_)?preapproval$/.test(type)) return ok;

  // Não confia no aviso: confere o status direto no Mercado Pago.
  const r = await fetch("https://api.mercadopago.com/preapproval/" + id, { headers: { Authorization: "Bearer " + process.env.MP_ACCESS_TOKEN } });
  if (!r.ok) return { statusCode: 500, body: "erro" }; // o Mercado Pago tenta de novo
  const d = await r.json();
  const uid = d.external_reference;
  if (!uid) return ok;
  const ref = db.doc("assinaturas/" + uid), sub = (await ref.get()).data();
  if (!sub || sub.mpId !== id) return ok; // assinatura antiga, outra ou conta já excluída
  await ref.set({ status: d.status, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await db.doc("prestadores/" + uid).update({ assinaturaAtiva: d.status === "authorized" }).catch(() => {});
  return ok;
};
