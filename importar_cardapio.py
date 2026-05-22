import requests, json, sys

BASE = "https://bortolini-pizzaria.onrender.com"

# Login
r = requests.post(f"{BASE}/api/login", json={"usuario":"adm","pin":"3725"})
if r.status_code != 200:
    print("Erro no login:", r.text)
    sys.exit(1)
token = r.json()["token"]
print("Login OK, token obtido")

itens = [
  {"name":"Calabresa","category":"Pizza","description":"Molho de tomate, muçarela, calabresa fatiada, queijo parmesão, orégano"},
  {"name":"Calabresa com Cebola","category":"Pizza","description":"Molho de tomate, muçarela, calabresa fatiada, cebola em rodelas, orégano"},
  {"name":"Calabresa com Farofa de Bacon","category":"Pizza","description":"Molho de tomate, muçarela, calabresa fatiada, farofa de bacon, orégano"},
  {"name":"Portuguesa","category":"Pizza","description":"Molho de tomate, muçarela, presunto, ovo cozido, cebola, ervilha, azeitona, orégano"},
  {"name":"Marguerita","category":"Pizza","description":"Molho de tomate, muçarela, tomate em rodelas, orégano. Manjericão fresco adicionado após o forno"},
  {"name":"Mexicana com Doritos","category":"Pizza","description":"Molho de tomate, muçarela, carne moída temperada, pimentão, cebola, milho, pimenta calabresa, orégano, Doritos. Doritos adicionados após o forno para manter crocância"},
  {"name":"Brócolis com Bacon","category":"Pizza","description":"Molho de tomate, muçarela (base), brócolis, farofa de bacon, muçarela (finalização), orégano"},
  {"name":"Alho e Óleo","category":"Pizza","description":"Molho de tomate, pasta de alho e óleo, queijo parmesão, orégano"},
  {"name":"Bacon","category":"Pizza","description":"Molho de tomate, muçarela (base), bacon crocante, muçarela (finalização), orégano"},
  {"name":"Milho","category":"Pizza","description":"Molho de tomate, muçarela, milho verde, orégano"},
  {"name":"Milho com Bacon","category":"Pizza","description":"Molho de tomate, muçarela, milho verde, bacon em cubos, orégano"},
  {"name":"Vegetariana","category":"Pizza","description":"Molho de tomate, muçarela, milho, ervilha, brócolis, azeitona, palmito, muçarela finalização, orégano"},
  {"name":"Coração","category":"Pizza","description":"Molho de tomate, muçarela, coração bovino em fatias, muçarela finalização, orégano"},
  {"name":"Filé ao Molho Mostarda","category":"Pizza","description":"Molho de tomate, muçarela, filé mignon ao molho mostarda, muçarela finalização, orégano"},
  {"name":"Filé Cremoso","category":"Pizza","description":"Molho de tomate, muçarela, filé mignon cremoso (requeijão + creme de leite), catupiry em espirais, orégano"},
  {"name":"Frango com Catupiry","category":"Pizza","description":"Molho de tomate, muçarela, frango desfiado temperado, catupiry em espirais, orégano"},
  {"name":"Frango Cremoso","category":"Pizza","description":"Molho de tomate, muçarela, frango cremoso (creme de leite + requeijão), queijo parmesão, orégano"},
  {"name":"Atum","category":"Pizza","description":"Molho de tomate, muçarela, atum sólido em óleo escorrido, orégano"},
  {"name":"Atum Especial","category":"Pizza","description":"Molho de tomate, muçarela, atum sólido em óleo, requeijão cremoso em fios, orégano"},
  {"name":"Estrogonofe de Carne","category":"Pizza","description":"Molho de tomate, muçarela, estrogonofe de carne, orégano. Batata palha adicionada após o forno"},
  {"name":"Estrogonofe de Frango","category":"Pizza","description":"Molho de tomate, muçarela, estrogonofe de frango em cubos, muçarela finalização, orégano. Batata palha adicionada após o forno"},
  {"name":"Costela Barbecue","category":"Pizza","description":"Molho de tomate, muçarela, costela desfiada ao molho barbecue, muçarela finalização, orégano. Toque extra de barbecue após o forno"},
  {"name":"Lombo com Abacaxi","category":"Pizza","description":"Molho de tomate, muçarela, lombo canadense, orégano. Abacaxi adicionado após o forno com leve queima de maçarico"},
  {"name":"Lombo c/ Farofa de Bacon e Catupiry","category":"Pizza","description":"Molho de tomate, muçarela, lombo canadense, farofa de bacon, catupiry em filetes, orégano. Catupiry distribuído em filetes antes de assar"},
  {"name":"Cinco Queijos","category":"Pizza","description":"Molho de tomate, muçarela, queijo prato, provolone, cheddar, catupiry, orégano"},
  {"name":"Bortolini Campeira ⭐","category":"Pizza","description":"Molho de tomate, muçarela, costela desfiada, creme de alho, queijo coalho. Finalizada com cebola crisps, chimichurri e cheiro verde (após forno)"},
  {"name":"Tomate Seco e Rúcula","category":"Pizza","description":"Molho de tomate, muçarela (base), tomate seco, orégano, muçarela (finalização). Rúcula fresca adicionada após o forno"},
  {"name":"Pizza Sushi de Atum Premium ⭐","category":"Pizza","description":"Molho de tomate, cream cheese, atum, cheiro verde, muçarela leve, molho teriyaki, gergelim. Cream cheese e teriyaki em riscos alternados"},
  {"name":"Dois Amores","category":"Pizza Doce","description":"Massa de pizza, creme de leite, chocolate branco derretido, chocolate preto derretido. Círculos alternados de chocolate branco e preto"},
  {"name":"Chocolate Branco","category":"Pizza Doce","description":"Massa de pizza, creme de leite, chocolate branco ralado. Finalizada com pedacinhos de Lacta após o forno"},
  {"name":"Chocolate Preto","category":"Pizza Doce","description":"Massa de pizza, creme de leite, chocolate preto. Chamusque com queimador após o forno; finalizar com pedaços de Lacta"},
  {"name":"Prestígio","category":"Pizza Doce","description":"Massa de pizza, creme de leite, chocolate ao leite, raspas/fios de chocolate, pedaços de Prestígio. Pedaços de Prestígio adicionados após o forno"},
  {"name":"Charge","category":"Pizza Doce","description":"Massa de pizza, chocolate preto, paçoca de amendoim esfarelada, pedaços de Charge. Paçoca e Charge adicionados após o forno"},
  {"name":"Kinder Bueno","category":"Pizza Doce","description":"Massa de pizza, creme de leite, chocolate preto (chamusquedo), pedaços de Kinder Bueno (Lacta). Chocolate chamusquedo com maçarico; Kinder Bueno após o forno"},
  {"name":"Banana com Canela","category":"Pizza Doce","description":"Massa de pizza, creme de leite, banana em fatias, mel, açúcar com canela"},
  {"name":"Pizza Bortolini ⭐","category":"Pizza Doce","description":"Massa de pizza, creme de leite, amendoim triturado, Nutella, chocolate ralado, morangos frescos. Chamusque com maçarico; morangos e amendoim adicionados após o forno"},
  {"name":"Bortolini Campeira Doce","category":"Pizza Doce","description":"Massa de pizza, creme de leite, Nutella, amendoim triturado, chocolate ralado. Variação doce especial da casa"},
  {"name":"Coca-Cola 2L","category":"Bebidas","description":"Refrigerante Coca-Cola garrafa 2 litros"},
  {"name":"Guaraná 2L","category":"Bebidas","description":"Refrigerante Guaraná garrafa 2 litros"},
  {"name":"Fanta 2L","category":"Bebidas","description":"Refrigerante Fanta garrafa 2 litros"},
  {"name":"Água com gás 500ml","category":"Bebidas","description":"Água mineral com gás 500ml"},
  {"name":"Água sem gás 500ml","category":"Bebidas","description":"Água mineral sem gás 500ml"},
]

r = requests.post(f"{BASE}/api/import-menu", json={"items": itens}, headers={"X-Session-Token": token})
print(r.status_code, r.json())
