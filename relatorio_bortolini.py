import urllib.request
import json
from datetime import datetime
from fpdf import FPDF

BASE = "https://bortolini-pizzaria.onrender.com"

def req(method, path, body=None, token=None):
    url = BASE + path
    r = urllib.request.Request(url, method=method)
    if token:
        r.add_header("X-Session-Token", token)
    if body is not None:
        r.add_header("Content-Type", "application/json")
        r.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return {"status": resp.status, "body": json.loads(resp.read().decode())}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": str(e.read().decode()[:100])}
    except Exception as e:
        return {"status": 0, "body": str(e)}

relatorio = {"data": datetime.now().strftime("%d/%m/%Y %H:%M:%S"), "testes": []}

def add_test(nome, status, detalhe=""):
    relatorio["testes"].append({"nome": nome, "status": status, "detalhe": detalhe})

r = req("GET", "/")
add_test("Health Check (homepage)", "OK" if r["status"]==200 else "FALHOU", f"HTTP {r['status']}")

r = req("POST", "/api/login", {"username": "adm", "pin": "3725"})
token = r["body"].get("token", "") if isinstance(r["body"], dict) else ""
add_test("Login Admin", "OK" if token else "FALHOU", f"Token: {token[:15]}..." if token else "Sem token")

r = req("GET", "/api/menu")
menu = r["body"] if isinstance(r["body"], list) else []
add_test("Cardapio Publico", "OK" if len(menu)>0 else "FALHOU", f"{len(menu)} itens")
relatorio["menu"] = menu

r = req("GET", "/api/settings", token=token)
s = r["body"] if isinstance(r["body"], dict) else {}
add_test("Configuracoes", "OK", f"Nome: {s.get('restaurant_name','?')}, PIX: {s.get('pix_key','?')[:20]}...")
relatorio["settings"] = s

r = req("GET", "/api/users", token=token)
users = r["body"] if isinstance(r["body"], list) else []
add_test("Usuarios", "OK", f"{len(users)} usuarios: {', '.join([u.get('name','?') for u in users])}")

r = req("GET", "/api/drivers", token=token)
drivers = r["body"] if isinstance(r["body"], list) else []
add_test("Entregadores", "OK", f"{len(drivers)} entregadores")
relatorio["drivers"] = drivers

r = req("POST", "/api/webhook/evolution", {"data": {"key": {"remoteJid": "5511999990000@s.whatsapp.net", "fromMe": False}, "message": {"conversation": "Teste relatorio"}}})
b = r["body"] if isinstance(r["body"], dict) else {}
add_test("Webhook Evolution", "OK" if b.get("ok") else "FALHOU", f"Conversa #{b.get('conversation_id','?')}")

r = req("GET", "/api/inbox", token=token)
inbox = r["body"] if isinstance(r["body"], list) else []
add_test("Inbox / Atendimento", "OK", f"{len(inbox)} conversas")

order_payload = {
    "customer": "Cliente Teste", "customer_phone": "5511999990000",
    "address": "Rua Teste, 123", "channel": "WhatsApp", "status": "Novo",
    "item": "1x Calabresa", "items": [{"name": "Calabresa", "qty": 1, "price": 45}],
    "total": 45, "payment": "PIX", "eta": "35 min", "delivery_type": "Entrega"
}
r = req("POST", "/api/orders", order_payload, token=token)
order = r["body"] if isinstance(r["body"], dict) else {}
oid = order.get("id", "?")
add_test("Criar Pedido", "OK" if oid != "?" else "FALHOU", f"Pedido #{oid}")

if oid != "?":
    r = req("GET", f"/api/public/orders/{oid}")
    o = r["body"] if isinstance(r["body"], dict) else {}
    add_test("Acompanhar Pedido (publico)", "OK", f"Pedido #{o.get('id','?')}: {o.get('status','?')}")
else:
    add_test("Acompanhar Pedido (publico)", "PULADO", "Sem pedido")

r = req("GET", "/entregador/3")
add_test("Pagina do Entregador (publico)", "OK" if r["status"]==200 else "FALHOU", f"HTTP {r['status']}")

r = req("POST", "/api/seed", token=token)
b = r["body"] if isinstance(r["body"], dict) else {}
add_test("Seed do Banco", "OK" if b.get("ok") else "FALHOU", f"Menu: {b.get('menu_items','?')} itens")

r = req("GET", "/api/stats", token=token)
st = r["body"] if isinstance(r["body"], dict) else {}
add_test("Estatisticas", "OK", f"Pedidos hoje: {st.get('today_orders','?')}, Faturamento: R$ {st.get('today_revenue',0)}")

class PDF(FPDF):
    def header(self):
        self.set_font("DejaVu", "B", 16)
        self.set_text_color(220, 38, 38)
        self.cell(0, 10, "Bortolini Pizzaria - Relatorio de Testes", ln=True, align="C")
        self.set_font("DejaVu", "", 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 6, f"Gerado em: {relatorio['data']}", ln=True, align="C")
        self.ln(5)
        self.set_draw_color(220, 38, 38)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font("DejaVu", "", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Pagina {self.page_no()}", align="C")

pdf = PDF()
try:
    pdf.add_font("DejaVu", "", "DejaVuSans.ttf", uni=True)
    pdf.add_font("DejaVu", "B", "DejaVuSans.ttf", uni=True)
except Exception as e:
    print(f"Aviso: usando fonte padrao ({e})")
    pdf.set_font("Arial", "", 12)

pdf.add_page()
pdf.set_auto_page_break(auto=True, margin=15)

pdf.set_font("DejaVu", "B", 12)
pdf.set_text_color(0, 0, 0)
pdf.cell(0, 8, "Resumo dos Testes", ln=True)
pdf.ln(2)

ok_count = sum(1 for t in relatorio["testes"] if t["status"] == "OK")
total = len(relatorio["testes"])
pdf.set_font("DejaVu", "", 10)
pdf.set_text_color(22, 163, 74)
pdf.cell(0, 6, f"{ok_count}/{total} testes passaram", ln=True)
pdf.set_text_color(0, 0, 0)
pdf.ln(3)

for t in relatorio["testes"]:
    if t["status"] == "OK":
        pdf.set_text_color(22, 163, 74)
        icon = "[OK]"
    elif t["status"] == "FALHOU":
        pdf.set_text_color(220, 38, 38)
        icon = "[FALHOU]"
    else:
        pdf.set_text_color(128, 128, 128)
        icon = "[PULADO]"
    pdf.set_font("DejaVu", "B", 9)
    pdf.cell(25, 5, icon, ln=0)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("DejaVu", "", 9)
    pdf.cell(0, 5, f"{t['nome']} - {t['detalhe']}", ln=True)

pdf.ln(5)

pdf.set_font("DejaVu", "B", 12)
pdf.cell(0, 8, f"Cardapio ({len(relatorio.get('menu', []))} itens)", ln=True)
pdf.ln(2)

pizzas_salgadas = [x for x in relatorio.get("menu", []) if x.get("category") == "Pizza"]
pizzas_doces = [x for x in relatorio.get("menu", []) if x.get("category") == "Pizza Doce"]
bebidas = [x for x in relatorio.get("menu", []) if x.get("category") == "Bebidas"]

pdf.set_font("DejaVu", "B", 10)
pdf.cell(0, 6, f"Pizzas Salgadas ({len(pizzas_salgadas)})", ln=True)
pdf.set_font("DejaVu", "", 9)
for item in pizzas_salgadas:
    pdf.cell(0, 4, f"  - {item['name']}", ln=True)

pdf.ln(2)
pdf.set_font("DejaVu", "B", 10)
pdf.cell(0, 6, f"Pizzas Doces ({len(pizzas_doces)})", ln=True)
pdf.set_font("DejaVu", "", 9)
for item in pizzas_doces:
    pdf.cell(0, 4, f"  - {item['name']}", ln=True)

pdf.ln(2)
pdf.set_font("DejaVu", "B", 10)
pdf.cell(0, 6, f"Bebidas ({len(bebidas)})", ln=True)
pdf.set_font("DejaVu", "", 9)
for item in bebidas:
    pdf.cell(0, 4, f"  - {item['name']}", ln=True)

pdf.ln(5)

pdf.set_font("DejaVu", "B", 12)
pdf.cell(0, 8, f"Entregadores ({len(relatorio.get('drivers', []))})", ln=True)
pdf.set_font("DejaVu", "", 9)
for d in relatorio.get("drivers", []):
    link = f"https://bortolini-pizzaria.onrender.com/entregador/{d.get('user_id', d.get('id', '?'))}"
    pdf.cell(0, 4, f"  - {d['name']} - Link: {link}", ln=True)

pdf.ln(5)

pdf.set_font("DejaVu", "B", 12)
pdf.cell(0, 8, "Configuracoes do Sistema", ln=True)
pdf.set_font("DejaVu", "", 9)
settings = relatorio.get("settings", {})
pdf.cell(0, 4, f"  Nome: {settings.get('restaurant_name', '?')}", ln=True)
pdf.cell(0, 4, f"  Horario: {settings.get('opening_hours', '?')}", ln=True)
pdf.cell(0, 4, f"  Taxa entrega: R$ {settings.get('delivery_fee', '?')}", ln=True)
pdf.cell(0, 4, f"  PIX: {settings.get('pix_key', '?')}", ln=True)
pdf.cell(0, 4, f"  Evolution URL: {settings.get('evolution_url') or 'Nao configurado'}", ln=True)

pdf.ln(5)

pdf.set_font("DejaVu", "B", 12)
pdf.cell(0, 8, "Links Importantes", ln=True)
pdf.set_font("DejaVu", "", 9)
pdf.cell(0, 4, "  Cardapio publico: https://bortolini-pizzaria.onrender.com/#pedir", ln=True)
pdf.cell(0, 4, "  Painel admin: https://bortolini-pizzaria.onrender.com/", ln=True)
pdf.cell(0, 4, "  Login: adm / PIN: 3725", ln=True)

pdf.output("relatorio_bortolini.pdf")
print("PDF gerado com sucesso!")
