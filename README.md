# Fitness Log V0.1.2

一个本地优先、无需账号、离线可用的饮食与训练记录 PWA。数据保存在当前浏览器的 `localStorage` 中，可通过 JSON 文件完整导入或导出。

## 使用方式

- 公网 PWA：<https://fitness-log-personal.netlify.app>
- Mac 本机：双击 `start.command`，或在项目目录执行 `python3 -m http.server 4173` 后打开 <http://localhost:4173>。
- iPhone 安装：使用 Safari 打开公网地址，点击“分享”，选择“添加到主屏幕”，再点“添加”。

> 不同域名和不同设备的 localStorage 相互独立。`localhost`、Netlify 公网地址、iPhone 和 Mac 不会自动同步，请使用 JSON 备份迁移数据。

## 构建

项目不依赖 Node.js 或前端构建框架。从源码生成可部署的 `dist/`：

```sh
./scripts/build.sh
```

本地验证构建结果：

```sh
python3 -m http.server 4173 --directory dist
```

Netlify 使用同一构建命令，并发布 `dist/`。`dist/` 是可重新生成的产物，不进入 Git。

## 信息架构

- **记录**：按日期记录饮食、训练、喝水和咖啡；训练卡片默认先打开只读详情，明确点击后才进入编辑。训练详情可在本地生成详细版、简版或纯文字版 PNG 分享图片。
- **月历**：按月查看饮食与训练标记，并快速进入某一天。
- **7 天**：查看 7 天饮食/训练汇总，并按动作查看完整历史表现。
- **备份**：导出完整 JSON，以“合并”或“替换”方式导入 JSON。

## V0.1.2 数据结构

```text
FitnessLogData (schemaVersion: 4)
├── days: { "YYYY-MM-DD": DayLog }
│   ├── meals[]
│   ├── sessions[]
│       ├── startTime, durationMin?, note?
│       ├── warmups[]
│       │   └── name, mode(reps|duration), reps?|durationMin?, note?
│       └── exercises[]
│           ├── exerciseId           # 指向动作库的稳定 ID
│           ├── name
│           ├── cues                  # 动作要点历史快照
│           ├── coachCorrection      # 仅属于本次训练
│           └── sets[]
│               └── weightKg?, reps?
│   ├── hydration[]
│   │   └── id, date, time, ml, createdAt
│   └── coffees[]
│       └── id, date, time, type, capacityMl?, createdAt
└── exerciseLibrary
│   └── { exerciseId: { id, name, cues, aliases[], updatedAt } }
└── settings
    └── hydrationTargetMl             # 本轮默认 2000
```

饮食热量、蛋白质和多数训练数值均可留空。应用不包含营养数据库，也不会自动推测任何数据。

## 向后兼容

- 继续使用原存储键 `fitness-log.data.v1`，现有浏览器会自动检测旧 schema。
- 每条旧训练记录迁移为一个训练场次。
- 旧 `sets × reps × weightKg` 会展开为多个独立 Set。
- 旧时长迁移为场次总时长；旧备注迁移为场次备注。
- 所有原训练字段会额外保存在 `legacySource`，不会静默丢失。
- V0.1.1 历史动作按规范化名称生成稳定 `exerciseId`；已有动作记录、Sets、动作要点和教练纠正不变。
- V0.1.1 热身默认迁移为 `mode: reps`，原次数保留。
- 从 schema 3 升级时只新增空的 `hydration` / `coffees` 集合和默认喝水目标，不改写已有饮食、训练和动作库内容。
- 首次升级 schema 4 前，原始数据会保存到 `fitness-log.data.v1.pre-v4-migration`。
- 导入旧 V0.1 / V0.1.1 JSON 时也会执行相同迁移。

## PWA 与部署

- `manifest.webmanifest` 使用 `standalone` 显示模式并提供 192/512 maskable icons。
- `icon-180.png` 用于 iPhone 主屏幕图标。
- 页面顶部和底部导航使用 `env(safe-area-inset-*)` 适配 iPhone 刘海、Dynamic Island 和 Home Indicator。
- `sw.js` 缓存完整 App Shell；页面导航采用网络优先、离线回退，静态资源采用缓存优先并后台刷新。
- Netlify 对 `sw.js` 和 manifest 使用必须重新验证的缓存头，避免版本更新长期卡在旧缓存。
- `netlify.toml` 的发布目录是 `dist/`；该目录由发布前的本地打包步骤生成。

## 数据与隐私

- 没有账号、云数据库、分析脚本或第三方运行时请求。
- 清理 Safari 网站数据、删除 PWA 或更换域名都可能使本地数据不可访问，请定期导出 JSON。
- 每次导入前，当前数据会保存在 `fitness-log.data.v1.pre-import`，作为临时回退副本。
