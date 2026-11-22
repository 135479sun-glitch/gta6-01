# Sunset Bay（落日湾）— gta6-01

2D 俯视开放世界游戏：你是 **Milo**，Sunset Bay 的一名司机/跑腿，靠接活谋生、躲警察、攒名声。
阳光现代海滨城市，网格路网 + 海滩 + 公园 + 市中心高楼 + 住宅区，全部原创地名与角色，
不用任何 Rockstar 素材。

## 玩法

- **步行**：WASD / 方向键移动，镜头跟随；靠近路边的车按 **E** 上车（偷车）。
- **开车**：W 加速、S 刹车/倒车、A/D 转向，街机手感；撞建筑或车会掉血、撞坏车。
- **交通**：AI 车沿道路行驶、路口减速；行人在人行道走，车快接近时会躲闪。
- **通缉（0–5 星）**：偷车 +1、撞行人 +1、撞警车 +2；≥1 星有警车追逐，星越高警车
  越多越快；脱离警车视线一段时间后星级衰减；进 **Coast Garage** 花钱清星。
- **任务**：3 个，难度递进，做完成为湾区小有名气的司机。
- **存档**：金钱、已完成任务、最佳成绩存在 localStorage；标题屏显示最佳成绩。

## 任务

| # | 任务 | 内容 |
|---|---|---|
| 1 | 第一单 First Fare | 开出租车接乘客、送到目的地。教上车与驾驶。 |
| 2 | 限时送件 Package Run | 限时内把包裹送过城。教路线规划与车速。 |
| 3 | 甩掉警察 Lose the Heat | 先到 2 星，再甩掉警车、开到藏身处。教通缉与逃脱。 |

每个任务：接取 → 指引标记（小地图与黄色信标）→ 完成给钱 → 解锁下一单。

## 操作

| 键 | 作用 |
|---|---|
| WASD / 方向键 | 步行移动 / 驾驶（W 加速、S 刹车/倒车、A/D 转向） |
| E | 上车 / 下车 |
| Space | 动作（接单/互动）；菜单中确认 |
| P 或 Esc | 暂停 / 继续 |
| M | 任务列表 |
| 点击 | 菜单确认 |

## 画面与 HUD

- 左上：通缉星（★）与金钱；顶部中央：时钟与当前任务目标；左下：Milo 血量；
  右下：车速；右上：小地图（canvas，显示道路、海滩、警车、任务目标与视野框）。
- 特效：撞击火花、刹车烟；警车顶灯闪烁；任务目标有脉冲信标与屏幕边缘方向箭头。
- 菜单：标题 → 游戏 → 暂停 → 任务列表 → 结算。

## 如何运行

离线静态文件，零网络请求，不需要构建：

```sh
node serve.ts
# 打开 http://localhost:8080
```

截图场景（桌面浏览器等 `window.__shotReady` 后截图）：

| 截图 | 场景 | 地址 |
|---|---|---|
| 1-start.jpg | 标题屏 + 阳光城市全景 | `?shot=start&seed=1` |
| 2-drive.jpg | 开车穿城、交通与行人 | `?shot=play&seed=1` |
| 3-chase.jpg | 警车追逐、2 星通缉 | `?shot=chase&seed=1` |
| 4-mission.jpg | 任务完成结算 | `?shot=end&seed=1` |

交付检查：

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
node cli/makefun.mjs check
```

## 文件结构

```
game/
  index.html          全屏 canvas + 小地图 + 菜单骨架
  src/
    config.js         调参与配色、城市常量、键位
    random.js         种子随机
    city.js           城市生成：路网、街区、建筑、公园、海滩
    world.js          状态与规则：步行/开车、交通 AI、行人、警察 AI、通缉、任务、钱、血量、碰撞
    missions.js       3 个任务的定义与流程
    render.js         只画：城市、车、行人、主角、HUD、小地图、特效、菜单
    input.js          只读键鼠，导出 input 状态
    sound.js          WebAudio 程序化音效（引擎、警笛、拾取、撞击）
    shots.js          ?shot= 定格场景（start/play/chase/end）
    main.js           启动、固定 1/60s 循环、?shot= 模式、菜单流程
    save.js           localStorage 存档
main.ts               交付 plumbing：拷 game/ 与 screenshots/ 到 /output，写 dossier.json
shots.json            4 张截图定义
serve.ts              本地静态服务器（node serve.ts → http://localhost:8080）
```

## 模块接口（对接约定，2026-11-22 实测对齐）

- `world.js`：`createWorld(random)` → `{ state, reset(), step(dt, input, harmless) }`；
  `step` 的 `input` 是 `{ up, down, left, right, enter }`（`enter` 边沿触发）；
  返回事件位标志 `EVENT_HIT(1) / EVENT_STEAL(2) / EVENT_WANTED(4) / EVENT_DEAD(8) /
  EVENT_MONEY(16) / EVENT_MISSION(32)`；`state` 含 `player { x, y, angle, health,
  onFoot, car, speed, invulnerable }`、`cars[] { id, x, y, angle, speed, color,
  isPlayer, isTaxi, isPolice, wrecked }`、**警车在 `state.police[]`（不在 cars 里）**、
  `pedestrians[] { x, y, angle, speed, state: 'walk'|'flee'|'down', color }`、
  `wanted`、`money`、`clockMinutes`（9:00 起）、`elapsed`、`camera { x, y }`（视野中心）、
  `mission`（见下）、`dead`、`stats { carsStolen, pedsHit, distanceDriven }`；
  `state.city` 见 city.js；`world` 不导出 `setWanted/spawnPolice`——改 `state.wanted`
  后 `step` 里的 `syncPolice` 会自动按星数刷警车。
- `city.js`：`createCity(random)` → `{ width, height, avenues[], streets[],
  roads[] { vertical, at, from, to, name }, buildings[] { x, y, width, height,
  type: 'house'|'tower'|'shop'|'hotel', floors?, name }, trees[] { x, y, r },
  props[] { kind: 'park'|'garage'|'gas', x, y, width, height, name },
  landmarks { spawn, garage, gasStation, taxiStand, packageDepot, hideout, park, beach },
  garage, gasStation, beach { x0, waterX } }`，另有 `isRoad/isSidewalk/buildingAt/
  inWater/clampToWorld/nearestRoadPoint/randomRoadPoint/randomSidewalkPoint/junctions()`。
- `missions.js`：`createMissions(world)` → `{ state, defs, places, nextMissionId,
  currentDef, start(id?), abandon, update(dt), objectiveText, snapshot, restore,
  pickTaxi }`；`update` 返回 `MISSION_EVENT_STAGE(1) / DONE(2) / FAILED(4) /
  ALL_DONE(8) / ACCEPTED(16)`；`state.mission` 形状 `{ activeId, stageIndex,
  stageId, objective, target { x, y, radius, label } | null, timer, timeLimit,
  completed[], rewardsEarned, allDone, finale }`；`world.reset()` 会替换
  `state.mission` 对象，所以 missions 控制器要在每次 `reset()` 后重建。
  **已知待对齐**：missions.js 的 `playerInCar/playerPosition/pickTaxi` 读
  `player.inCar / player.carId` 与 `car.kind === 'taxi'`，而 world.js 实际用
  `player.onFoot / player.car（对象）` 与 `car.isTaxi`——任务 1 的 get-taxi
  阶段目前无法靠 missions.js 自己的检查通过，shots.js 的 end 场景用直接标记
  完成兜底；集成时请工人 B 按 world.js 改 missions.js。
- `save.js`：`loadSave()` → `{ version, money, completedMissions,
  best { money, missionsCompleted, packageRunSeconds }, savedAt } | null`；
  `saveGame({ money, completedMissions, best? })`，`saveFromWorld(state, missions)`，
  `hasSave()`，`clearSave()`，`mergeBest(old, candidate)`。
- `sound.js`：导出单例 `sound`：`engine(on)`、`engineSpeed(0–1)`、`siren(on)`、
  `pickup()`、`crash()`、`missionDone()`、`missionFailed()`、`click()`、
  `setMuted()/isMuted()/toggleMuted()`、`stopAll()`；无 WebAudio 时全部静默空操作。

## 许可

MIT（见 LICENSE）。
