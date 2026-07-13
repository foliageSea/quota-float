# Sub2API 对接接口文档

本文档根据 Quota Float 当前实现整理，用于 Sub2API 服务端联调、接口兼容性检查和客户端维护。文档描述的是本项目实际调用的接口与字段，不代表 Sub2API 的完整开放接口。

对应实现：`src/main/index.ts`。

## 1. 对接概览

| 能力 | 方法 | 路径 | 调用时机 |
| --- | --- | --- | --- |
| 获取全部分组 | `GET` | `/api/v1/admin/groups/all` | 刷新用量时 |
| 获取账号列表 | `GET` | `/api/v1/admin/accounts` | 刷新用量时 |
| 获取单账号用量 | `GET` | `/api/v1/admin/accounts/{accountId}/usage` | 刷新用量时，对筛选后的每个账号并发调用 |
| 获取代理列表 | `GET` | `/api/v1/admin/proxies` | 刷新代理状态时 |
| 测试代理 | `POST` | `/api/v1/admin/proxies/{proxyId}/test` | 已选择代理时随代理刷新调用，或由用户主动触发 |

一次用量刷新会产生 `2 + N` 个 HTTP 请求：分组和账号列表各 1 个，加上筛选后每个账号 1 个 usage 请求。账号列表当前只读取前 200 条。

## 2. 公共约定

### 2.1 Base URL

用户配置 Sub2API 地址，例如：

```text
https://sub2.example.com
```

保存时会去除末尾的 `/`，接口最终拼接为：

```text
https://sub2.example.com/api/v1/admin/...
```

### 2.2 请求头

所有请求均携带：

```http
Accept: application/json
```

认证信息兼容管理员 API Key 与登录 JWT。客户端会按下表顺序尝试；仅收到 HTTP `401` 时才尝试下一个候选头。

| 配置值形式 | 认证候选顺序 |
| --- | --- |
| 以 `Bearer ` 开头 | `Authorization: <原值>` |
| 以 `eyJ` 开头的 JWT | `Authorization: Bearer <原值>` |
| 以 `admin-` 开头 | `X-API-Key: <原值>` → `Authorization: <原值>` → `Authorization: Bearer <原值>` |
| 其他值 | `Authorization: Bearer <原值>` → `X-API-Key: <原值>` → `Authorization: <原值>` |

管理员密钥和 JWT 仅保存在 Electron 用户数据目录的 `config.json`，不应硬编码到源码、日志或示例配置中。

### 2.3 时区参数

客户端会为每个请求自动追加 `timezone` 查询参数，值来自系统 IANA 时区：

```text
timezone=Asia/Shanghai
```

若请求路径已经包含 `timezone`，客户端不会覆盖。服务端应接受该参数；需要生成重置时间时，应按该时区返回或提供包含时区信息的时间字符串。

### 2.4 响应信封

所有接口应返回 JSON，公共结构如下：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | `number` | 是 | `0` 表示业务成功，非 `0` 视为失败 |
| `message` | `string` | 否 | 错误说明；业务失败时会直接展示给用户 |
| `data` | 任意 JSON | 是 | 各接口的数据主体 |

客户端同时要求 HTTP 状态码为 `2xx`。处理规则：

- HTTP `401`：存在其他认证候选时继续尝试，否则报告认证失败。
- 其他非 `2xx`：报告 `Sub2API 请求失败：<status>`，不读取业务错误内容。
- HTTP `2xx` 但 `code !== 0`：使用 `message` 报错；无 `message` 时显示通用错误。
- HTTP `2xx` 且 `code === 0`：读取 `data`。

## 3. 分组接口

### 获取全部分组

```http
GET /api/v1/admin/groups/all?timezone=Asia%2FShanghai
```

无业务请求参数。

`data` 为分组数组：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": 1,
      "name": "Codex 主账号",
      "platform": "openai",
      "status": "active",
      "account_count": 10,
      "active_account_count": 8
    }
  ]
}
```

| `data[]` 字段 | 类型 | 必填 | 客户端用途 |
| --- | --- | --- | --- |
| `id` | `number` | 是 | 分组筛选与账号归属匹配 |
| `name` | `string` | 是 | 分组选择器和网页展示 |
| `platform` | `string` | 是 | 保留字段 |
| `status` | `string` | 是 | 保留字段 |
| `account_count` | `number` | 否 | 当前未展示 |
| `active_account_count` | `number` | 否 | 当前未展示 |

## 4. 账号接口

### 4.1 获取账号列表

```http
GET /api/v1/admin/accounts?page=1&page_size=200&platform=&type=&status=&privacy_mode=&group=&search=&sort_by=name&sort_order=asc&lite=1&timezone=Asia%2FShanghai
```

| 参数 | 当前值 | 说明 |
| --- | --- | --- |
| `page` | `1` | 只请求第一页 |
| `page_size` | `200` | 单页最多读取 200 个账号 |
| `platform` | 空 | 不按平台筛选 |
| `type` | 空 | 不按类型筛选 |
| `status` | 空 | 不按状态筛选 |
| `privacy_mode` | 空 | 不按隐私模式筛选 |
| `group` | 空 | 服务端不筛分组，由客户端在本地筛选 |
| `search` | 空 | 不搜索 |
| `sort_by` | `name` | 按名称排序 |
| `sort_order` | `asc` | 升序 |
| `lite` | `1` | 使用精简账号数据 |

`data.items` 为账号数组：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": 101,
        "name": "account-a",
        "status": "active",
        "credentials": {
          "email": "user@example.com",
          "plan_type": "team"
        },
        "group_ids": [1],
        "groups": [
          {
            "id": 1,
            "name": "Codex 主账号",
            "platform": "openai",
            "status": "active"
          }
        ],
        "extra": {
          "email": "user@example.com",
          "codex_5h_used_percent": 18,
          "codex_5h_reset_at": "2026-07-13T15:00:00+08:00",
          "codex_7d_used_percent": 42,
          "codex_7d_reset_at": "2026-07-18T00:00:00+08:00",
          "codex_usage_updated_at": "2026-07-13T10:30:00+08:00"
        }
      }
    ]
  }
}
```

| `data.items[]` 字段 | 类型 | 必填 | 客户端用途 |
| --- | --- | --- | --- |
| `id` | `number` | 是 | 请求单账号用量 |
| `name` | `string` | 是 | 账号展示 |
| `status` | `string` | 是 | 状态展示 |
| `credentials.email` | `string` | 否 | 邮箱展示，优先于 `extra.email` |
| `credentials.plan_type` | `string` | 否 | 套餐展示 |
| `group_ids` | `number[]` | 否 | 分组匹配，优先于 `groups` |
| `groups` | `Group[]` | 否 | `group_ids` 缺失时用于分组匹配，同时提供分组名 |
| `extra` | `object` | 否 | 单账号 usage 请求失败时的用量回退数据 |

当前客户端不读取 `data.total` 等分页元数据。账号超过 200 个时，后续页不会进入统计。

### 4.2 获取单账号用量

```http
GET /api/v1/admin/accounts/{accountId}/usage?timezone=Asia%2FShanghai
```

| 路径参数 | 类型 | 说明 |
| --- | --- | --- |
| `accountId` | `number` | 来自账号列表的 `id` |

成功响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "updated_at": "2026-07-13T10:30:00+08:00",
    "five_hour": {
      "utilization": 18,
      "resets_at": "2026-07-13T15:00:00+08:00"
    },
    "seven_day": {
      "utilization": 42,
      "resets_at": "2026-07-18T00:00:00+08:00"
    }
  }
}
```

| `data` 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `updated_at` | `string` | 否 | 用量数据更新时间 |
| `five_hour.utilization` | `number` | 否 | 5 小时窗口已使用百分比，客户端按 `0-100` 展示 |
| `five_hour.resets_at` | `string` | 否 | 5 小时窗口重置时间 |
| `seven_day.utilization` | `number` | 否 | 7 天窗口已使用百分比，客户端按 `0-100` 展示 |
| `seven_day.resets_at` | `string` | 否 | 7 天窗口重置时间 |

时间字段建议使用 ISO 8601 且包含时区，例如 `2026-07-13T15:00:00+08:00`。客户端虽按字符串接收，但最终交给 JavaScript `Date` 解析。

#### 用量回退规则

单账号 usage 请求出现任何错误时，不会中断整批刷新，而是从账号列表的 `extra` 读取：

| 标准 usage 字段 | `extra` 回退字段 |
| --- | --- |
| `five_hour.utilization` | `codex_5h_used_percent` |
| `five_hour.resets_at` | `codex_5h_reset_at` |
| `seven_day.utilization` | `codex_7d_used_percent` |
| `seven_day.resets_at` | `codex_7d_reset_at` |
| `updated_at` | `codex_usage_updated_at` |

数值缺失或不是有限 `number` 时按 `0` 处理；时间缺失或不是 `string` 时按空字符串处理。

## 5. 代理接口

### 5.1 获取代理列表

```http
GET /api/v1/admin/proxies?page=1&page_size=200&sort_by=id&sort_order=desc&timezone=Asia%2FShanghai
```

`data.items` 为代理数组：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": 7,
        "name": "Proxy A",
        "protocol": "http",
        "host": "127.0.0.1",
        "port": 7890,
        "status": "active",
        "latency_ms": 120,
        "latency_status": "ok",
        "latency_message": "reachable",
        "ip_address": "203.0.113.10",
        "country": "China",
        "country_code": "CN",
        "region": "Shanghai",
        "city": "Shanghai",
        "quality_status": "good",
        "quality_score": 95,
        "quality_grade": "A",
        "quality_summary": "stable",
        "quality_checked": 1
      }
    ]
  }
}
```

| `data.items[]` 字段 | 类型 | 必填 | 客户端用途 |
| --- | --- | --- | --- |
| `id` | `number` | 是 | 代理选择与测试 |
| `name` | `string` | 是 | 展示名称 |
| `protocol` | `string` | 是 | 展示代理地址 |
| `host` | `string` | 是 | 展示代理地址 |
| `port` | `number` | 是 | 展示代理地址 |
| `status` | `string` | 是 | 保留字段 |
| `latency_ms` | `number` | 否 | 最近延迟 |
| `latency_status` | `string` | 否 | 状态颜色的次选依据 |
| `latency_message` | `string` | 否 | 状态说明 |
| `ip_address` | `string` | 否 | 最近出口 IP |
| `country` / `country_code` | `string` | 否 | 地理位置 |
| `region` / `city` | `string` | 否 | 地理位置 |
| `quality_status` | `string` | 否 | 状态颜色的首选依据 |
| `quality_score` | `number` | 否 | 保留字段 |
| `quality_grade` | `string` | 否 | 保留字段 |
| `quality_summary` | `string` | 否 | 质量说明，优先于 `latency_message` 展示 |
| `quality_checked` | `number` | 否 | 保留字段 |

当前只读取第一页 200 条代理，不读取分页元数据。

### 5.2 测试代理

```http
POST /api/v1/admin/proxies/{proxyId}/test?timezone=Asia%2FShanghai
```

请求无 Body。

成功响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "success": true,
    "message": "proxy is reachable",
    "latency_ms": 118,
    "ip_address": "203.0.113.10",
    "city": "Shanghai",
    "region": "Shanghai",
    "country": "China",
    "country_code": "CN"
  }
}
```

| `data` 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `success` | `boolean` | 是 | 代理是否可用 |
| `message` | `string` | 是 | 测试结果说明 |
| `latency_ms` | `number` | 否 | 测试延迟，毫秒 |
| `ip_address` | `string` | 否 | 出口 IP |
| `city` / `region` | `string` | 否 | 城市与地区 |
| `country` / `country_code` | `string` | 否 | 国家名称与代码 |

`success: false` 仍可放在 `code: 0` 的成功业务响应中，客户端会将其展示为“异常”，并显示 `data.message`。

## 6. 客户端数据处理

### 6.1 分组筛选

账号接口始终请求全部账号，客户端再按以下规则筛选：

1. 优先使用账号的 `group_ids`。
2. `group_ids` 缺失时使用 `groups[].id`。
3. 选择“全部分组”时保留所有账号，否则只保留包含目标分组 ID 的账号。

### 6.2 汇总计算

客户端将筛选后的账号转换为统一结构，并计算：

| 字段 | 计算方式 |
| --- | --- |
| `accountCount` | 账号数量 |
| `fiveHourAverage` | 所有账号 5h 已使用百分比的算术平均值，四舍五入到整数 |
| `fiveHourMax` | 5h 已使用百分比最大值，无账号时为 `0` |
| `sevenDayAverage` | 所有账号 7d 已使用百分比的算术平均值，四舍五入到整数 |
| `sevenDayMax` | 7d 已使用百分比最大值，无账号时为 `0` |

缺失用量会以 `0` 参与平均值计算。客户端不按账号 `status` 排除停用账号。

### 6.3 刷新策略

- 用量默认每 60 秒刷新，允许配置，最小 15 秒。
- 保存配置后立即刷新一次用量。
- 后台轮询单次失败不会停止后续轮询。
- 代理默认每 300 秒刷新，允许配置，最小 15 秒；该轮询由渲染进程的每个活动窗口维护。
- 未选择代理时，代理刷新只请求代理列表，不调用测试接口。

## 7. 联调检查清单

- 所有接口均返回 `Content-Type: application/json` 和统一响应信封。
- 至少支持项目使用的一种认证头形式，并以 HTTP `401` 表示认证失败。
- 接受所有请求附带的 `timezone` 参数。
- 账号列表在 `lite=1` 时仍提供 `id`、名称、状态和分组归属。
- usage 接口的 `utilization` 返回百分数而非 `0-1` 小数。
- 重置时间和更新时间能被 JavaScript `Date` 正确解析。
- 账号 usage 单点失败时，账号 `extra.codex_*` 字段可作为兼容回退。
- 列表规模超过 200 时，需要扩展客户端分页，否则统计不完整。
- 服务端应评估一次刷新对 N 个账号并发请求 usage 的承载能力。

## 8. 当前限制

- 客户端没有请求超时或重试退避；网络请求可能长时间等待。
- 只有 HTTP `401` 会切换认证头，`403` 不会尝试其他认证形式。
- 账号和代理列表均固定读取第一页、最多 200 条。
- 单账号 usage 请求没有并发上限。
- 非 `2xx` 响应的 JSON 错误详情不会展示。
- 本文示例中的状态枚举仅为示意；当前客户端把状态字段作为普通字符串处理，没有约束服务端枚举。
