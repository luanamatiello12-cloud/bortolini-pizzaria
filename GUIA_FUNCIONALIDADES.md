# Guia de funcionalidades - Bortolini Pizzaria e delivery

Este guia explica como usar cada parte do sistema.

## Acesso

Abra:

```text
http://127.0.0.1:8000
```

Todos os usuários de demonstração usam PIN `1234`.

| Perfil | Email | O que acessa |
| --- | --- | --- |
| Dono/Admin | admin@bortolini.com | Tudo |
| Gerente | gerente@bortolini.com | Operação, cardápio, entregas, clientes, relatórios e configurações |
| Atendente | atendente@bortolini.com | Pedidos, cliente QR, atendimento e clientes |
| Cozinha | cozinha@bortolini.com | Visão geral e pedidos |
| Entregador | entregador@bortolini.com | Entregas, app do entregador e pedidos |
| Financeiro | financeiro@bortolini.com | Financeiro, clientes e relatórios |

## Visão geral

Mostra os principais números do dia:

- vendas
- pedidos ativos
- ticket médio
- taxa de resposta IA
- pedidos em tempo real
- canais automatizados
- fila da cozinha

Use essa tela para acompanhar rapidamente a operação.

## Cliente QR

Simula o cardápio que o cliente acessa pelo QR Code.

Funcionalidades:

- visualizar produtos ativos
- ver fotos dos produtos
- ver promoções aplicadas
- adicionar itens ao carrinho
- informar nome, telefone, endereço e observações
- escolher entrega ou retirada
- escolher forma de pagamento
- finalizar pedido

Quando o cliente finaliza, o pedido entra automaticamente na tela **Pedidos**.

## Pedidos

Central de controle dos pedidos.

Funcionalidades:

- filtrar por status: Todos, Novo, Cozinha, Entrega e Finalizado
- ver cliente, canal, tipo de entrega, produto e total
- avançar status do pedido
- imprimir pedido individual
- gerar mensagem pronta para WhatsApp
- exportar CSV

Fluxo de status:

```text
Novo -> Cozinha -> Entrega -> Finalizado
```

## Cardápio

Área de gestão dos produtos.

Funcionalidades:

- criar produto simples
- adicionar foto ao produto
- editar nome, categoria, preço e foto
- pausar ou ativar produto
- criar promoções
- ver lista de promoções lançadas

Produtos pausados não aparecem no cardápio do cliente.

## Promoções

Ficam dentro do módulo **Cardápio**.

Tipos disponíveis:

- porcentagem
- valor fixo
- preço promocional

Também é possível escolher canais:

- Cardápio QR
- WhatsApp
- Instagram
- Facebook

## Atendimento IA

Simulação de atendimento por canais digitais.

Canais representados:

- WhatsApp
- Instagram
- Facebook

Permite ver conversas e enviar respostas simuladas.

## Entregas

Mostra o mapa operacional das entregas.

Funcionalidades:

- ver entregas ativas
- ver entregador vinculado ao pedido
- ver localização do entregador
- ver destino do cliente
- acompanhar atualização de posição

Atualmente a localização pode usar GPS real do navegador/celular ou simulação.

## App entregador

Tela pensada para uso no celular do entregador.

Funcionalidades:

- ver entregas em rota
- compartilhar localização
- usar GPS real se o navegador permitir
- marcar pedido como entregue

Se o GPS não estiver disponível ou for negado, o sistema usa simulação.

## Pagamentos

Painel financeiro.

Funcionalidades:

- ver total recebido
- ver pagamentos por PIX, cartão e carteiras
- filtrar por dia, semana ou mês
- listar transações

Hoje é um painel operacional simulado; a integração real é configurada em **Integrações**.

## Relatórios

Mostra indicadores comerciais:

- vendas por canal
- pratos/produtos mais vendidos
- desempenho da semana

Ajuda a entender quais canais e produtos vendem melhor.

## Clientes

Lista clientes salvos automaticamente a partir dos pedidos.

Dados exibidos:

- nome
- telefone
- endereço
- preferências/observações

Útil para histórico, recorrência e atendimento mais personalizado.

## Configurações

Configura dados principais da pizzaria:

- nome
- horário de funcionamento
- taxa de entrega
- tempo médio de preparo
- bairros atendidos

Essas informações aparecem no cardápio do cliente.

## Integrações

Central para preparar o sistema para produção.

Áreas:

- pagamento online
- chave PIX
- token de gateway
- WhatsApp oficial
- token/API de WhatsApp
- GPS
- domínio para deploy
- checklist de publicação

Essa tela ainda não conecta com serviços reais, mas deixa tudo organizado para a próxima etapa.

## Impressão

Existem dois usos:

- imprimir mapa/fila da cozinha
- imprimir pedido individual

O pedido individual abre uma página simples pronta para impressão.

## WhatsApp

Na tela **Pedidos**, o botão WhatsApp:

- monta mensagem de status do pedido
- copia a mensagem
- abre o WhatsApp via `wa.me` quando existe telefone

## Rodar o sistema

Opção rápida:

```text
INICIAR_BORTOLINI.bat
```

Ou pelo terminal:

```powershell
python server.py
```

Depois acesse:

```text
http://127.0.0.1:8000
```

## Próximos passos recomendados

- cadastrar o cardápio real completo
- configurar WhatsApp oficial
- configurar pagamento real
- publicar online com domínio
- trocar PIN por senha segura antes de produção
