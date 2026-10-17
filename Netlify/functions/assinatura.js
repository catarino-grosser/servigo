// Cria, consulta preço e cancela a assinatura do prestador (Mercado Pago).
// Variáveis no Netlify: MP_ACCESS_TOKEN, PRECO (ex.: 29.90), SITE_URL, FIREBASE_SERVICE_ACCOUNT
const admin = require("firebase-admin");
const crypto = require("crypto");
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore(), MP = "https://api.mercadopago.com";
const H = { Authorization: "Bearer " + process.env.MP_ACCESS_TOKEN, "Content-Type": "application/json" };
const out = (s, o) => ({ statusCode: s, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (e) => {
  if (e.httpMethod !== "POST") return out(405, { erro: "Método não permitido" });
  let uid, email;
  try {
    const t = (e.headers.authorization || "").replace(/^Bearer /, "");
    const d = await admin.auth().verifyIdToken(t); // só aceita usuário logado de verdade
    uid = d.uid; email = d.email;
  } catch (x) { return out(401, { erro: "Entre na sua conta de novo" }); }
  let b = {}; try { b = JSON.parse(e.body || "{}"); } catch (x) {}
  const ref = db.doc("assinaturas/" + uid), perfil = db.doc("prestadores/" + uid);
  const sub = (await ref.get()).data();

  if (b.acao === "info") return out(200, { preco: "R$ " + Number(process.env.PRECO).toFixed(2).replace(".", ",") });

  if (b.acao === "criar") {
    if (!(await perfil.get()).exists) return out(400, { erro: "Crie seu perfil antes de assinar" });
    if (sub && sub.status === "authorized") return out(409, { erro: "Você já tem uma assinatura ativa" });
    if (!b.token) return out(400, { erro: "Dados do cartão inválidos" });
    const r = await fetch(MP + "/preapproval", {
      method: "POST",
      headers: { ...H, "X-Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        reason: "Assinatura ServiGo",
        external_reference: uid,
        payer_email: email,
        card_token_id: b.token,
        back_url: process.env.SITE_URL,
        status: "authorized",
        auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: Number(process.env.PRECO), currency_id: "BRL" }
      })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return out(400, { erro: d.message || "Pagamento não aprovado. Confira os dados do cartão" });
    const ativa = d.status === "authorized";
    await ref.set({ mpId: d.id, status: d.status, email: email || null, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await perfil.update({ assinaturaAtiva: ativa });
    return out(200, { ativa, status: d.status });
  }

  if (b.acao === "cancelar") {
    if (sub && sub.mpId && sub.status !== "cancelled") {
      const r = await fetch(`${MP}/preapproval/${sub.mpId}`, { method: "PUT", headers: H, body: JSON.stringify({ status: "cancelled" }) });
      if (!r.ok) return out(502, { erro: "Não foi possível cancelar agora. Tente de novo" });
    }
    await perfil.update({ assinaturaAtiva: false }).catch(() => {});
    if (b.apagar) await ref.delete(); else if (sub) await ref.set({ status: "cancelled" }, { merge: true });
    return out(200, { ok: true });
  }
  return out(400, { erro: "Ação inválida" });
};
