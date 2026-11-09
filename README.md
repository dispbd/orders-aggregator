# orders-aggregator

Сервис забирает заказы интернет-магазина из внешней системы (API поддерживает другая команда),
принимает их обновления через вебхуки и считает статистику по клиентам.

## Стек

Node 20+, TypeScript, Fastify, PostgreSQL (`pg`), Zod, Vitest.

## Запуск

Образ внешнего API лежит рядом с этой папкой — загрузите тот, что под вашу архитектуру (`uname -m`):

```bash
docker load -i ../orders-mock-arm64.tar.gz   # arm64 / aarch64 (Mac на Apple Silicon)
docker load -i ../orders-mock-amd64.tar.gz   # x86_64
```

```bash
cp .env.example .env
docker compose up -d        # PostgreSQL (+ тестовая БД orders_test) и внешний API на :4000
npm install
npm run migrate
npm run dev                 # http://localhost:3000
```

Отправка вебхуков из внешней системы (для разработки запускается вручную, сервис должен быть запущен):

```bash
docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order
```

Тесты (нужен запущенный PostgreSQL):

```bash
npm test
```

## Структура

```
src/
  app.ts              Fastify-приложение, обработка ошибок
  container.ts        сборка зависимостей
  db.ts               пул соединений, миграции
  clients/            клиент внешнего API (лимиты, ретраи)
  repositories/       доступ к данным
  services/           бизнес-логика
  routes/             HTTP-слой
  utils/              деньги, время
migrations/           SQL-миграции, применяются по порядку
test/                 интеграционные тесты на реальной БД (внешний API — фейк)
```

## Соглашения

- Деньги внутри сервиса — в копейках (integer). Рубли — только на входе из внешнего API и в ответах.
- Время храним в UTC (`TIMESTAMPTZ`).
- Ошибки бизнес-логики — наследники `AppError`, в ответе `{ error: <код>, message }`.

## API сервиса

| Метод | Путь | Описание |
|---|---|---|
| POST | `/sync` | Забрать все заказы из внешнего API. Отвечает статистикой, когда всё забрано |
| POST | `/webhooks/order` | Обновление заказа (тело — `Order` внешнего API). Повтор/устаревшая версия → `200 { result: "stale" }` |
| GET | `/customers/:id/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD` | Суммы оплаченных (`paid`) заказов по дням в таймзоне клиента: `[{ date, total, gross, discount, net }]` |

`daily-totals`, суммы в рублях с точностью до копейки:

- `gross` — сумма оплаченных заказов до скидки;
- `net` — сколько клиенты фактически заплатили (`amountPaid`);
- `discount` — `gross - net`;
- `total` — для обратной совместимости, равен `gross`.

День заказа — календарная дата `createdAt` в таймзоне клиента с учётом перехода на летнее/зимнее время.
| GET | `/health` | Проверка живости |

## Внешний API (`ORDERS_API_URL`)

- `GET /orders?cursor=<string>&limit=<1..100>` → `{ items: Order[], nextCursor: string | null }`. Лимит 5 rps.
- `GET /customers/:id` → `{ id, timezone }` (IANA, например `Europe/Berlin`).
- Вебхуки: `POST` на наш `/webhooks/order`, тело — `Order`. Повторная доставка возможна.

```ts
type Order = {
  id: string;
  customerId: string;
  amount: number;          // сумма заказа в рублях, до скидки
  discountPercent: number; // скидка, % (0 — без скидки)
  amountPaid: number;      // оплачено, в рублях: amount со скидкой
  status: "pending" | "paid" | "refunded";
  createdAt: string;       // ISO 8601, UTC
  updatedAt: string;       // ISO 8601, UTC
};
```

`discountPercent` и `amountPaid` появились в API недавно: в заказах, созданных до 15.03.2026, их нет. Как и `amount`,
они иногда приходят строкой. Сервис берёт `net` из `amountPaid`; без него — считает из `discountPercent`;
без обоих — считает, что скидки не было.

Миграция `002_discounts.sql` добавляет `amount_paid_kop`. Строки, сохранённые до неё, считаются без скидки,
пока не придёт их версия с `amountPaid`. После деплоя выполните `POST /sync`: он дозаполнит строки, даже если версия
заказа не менялась. Исключение — заказы, чья последняя версия пришла вебхуком: `/orders` отдаёт по ним более
старый снимок, поэтому они дозаполнятся только следующим событием по заказу.
