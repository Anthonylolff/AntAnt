# 家居 3D

唔使畫戶型：用 iPhone 掃描、CAD 圖、Sweet Home 3D、3D 模型或者掃地機地圖匯入，就變成一個撳得、改得嘅 3D 屋企，再接 Home Assistant 做全屋中控。

純靜態網頁（HTML + JS 模組 + three.js），唔使 build，冇後台。所有平面圖同設定都存喺瀏覽器 `localStorage`。

## 功能

| 頁 | 做咩 |
|---|---|
| **3D** | 撳房間：鏡頭飛過去，右邊列出嗰間房所有 HA 裝置（燈、窗簾、冷氣、鏡頭、電視、掃地機、感應器）。撳裝置泡泡直接控制。頂部有能源列（用電、電網、太陽能、電池、電價）。|
| **風格** | 9 套：霓虹、合成波、溫馨、建築模型、冬夜、日光、藍圖、日式原木、黑金。可以自己調牆色、木色、布料、櫃色；可以跟太陽日夜自動換。|
| **日照時光** | 拉時間軸睇一日太陽點行、影子點變，或者「播一日」。有連 HA 就用 `sun.sun` 嘅真實位置。|
| **編輯** | 左邊 2D、右邊 3D 即時跟住變。畫房（自動起牆）、畫牆、加門窗、拖角改形、「+」加角、傢俬庫（35 款）、放 HA 裝置、底圖描圖、核對清單、復原／重做。|
| **匯入** | iPhone 掃描 `.usdz`、Apple RoomPlan `.json`、CAD `.dxf`、Sweet Home 3D `.sh3d`、`.glb/.gltf/.obj/.stl`、Valetudo 地圖 `.json`、本 app／AI 寫嘅 plan `.json`。全部喺瀏覽器處理，唔會上傳。|
| **搵嘢** | 打字或者講嘢（🎙）：「洗衣機喺邊」→ 飛去嗰度閃一下。房間可以設語音別名。|

## 接 Home Assistant

1. HA → 個人資料 → 安全 → 建立「長期存取權杖」。
2. 喺 **設定** 揀「連我嘅 HA」，填網址同權杖。
3. 編輯頁揀房間 →「HA 區域」揀返對應區域 →「由 HA 區域放裝置」，或者喺「💡 裝置」逐個放。
4. 門／窗可以綁門磁或者窗簾實體，3D 入面就會跟住開合。

**http / https：** 如果呢頁用 https 開（例如 Vercel），而 HA 係 `http://…:8123`，瀏覽器會擋。最穩陣嘅做法係將成個 `home/` 資料夾放入 HA：

```
/config/www/home3d/   ← 將 home/ 入面所有檔案抄入去
```

再開 `http://<你的HA>:8123/local/home3d/index.html`。想喺 HA 側欄出現：設定 → 儀表板 → 新增儀表板 → 「網頁」，網址填上面嗰條。牆上平板開呢頁就係全屋中控。

## 匯入格式備註

- **iPhone USDZ**：RoomPlan 參數模型（prim 名有 `Wall`、`Door`、`Window`、`Opening`、`Floor`、`Bed`、`Sofa`…）會自動變成牆、門窗、房同傢俬；冇呢啲結構嘅掃描網格就當 3D 模型參考。用 three.js 0.187 嘅 USDC／USDA 解析器（喺 jsDelivr 載入）。
- **RoomPlan JSON**：`CapturedRoom` / `CapturedStructure` JSON。iOS 17 嘅 `floors` 多邊形同 `sections` 房名都會用到；多層（`story`）會分開做唔同樓層。平面會自動轉正。
- **DXF**：牆最好喺 `WALL`／`牆` 圖層；雙線牆會自動配對成中線＋厚度。房間用閉合多段線放 `ROOM` 圖層，房名用文字。門認門圖塊（名有 DOOR／門）或者門弧。原本嘅線會變底圖。
- **3D 模型**：只做半透明參考（唔會儲存）＋由頂影一張底圖，要用「房間」工具描一次。
- **掃地機地圖**：每個分區變一個長方形房，再對住底圖修正。

匯入後每間房都標「待核對」，請逐間對牆厚、門口、窗台高，剔「已核對」。掃描唔係施工圖。

## 叫 AI 寫 plan

匯入頁最底有範本。最簡單嘅格式（單位米，x 向右、y 向下，`rot` 順時針度數；冇 `walls` 就由房間自動起牆）：

```json
{
  "name": "我屋企",
  "floors": [{
    "name": "地下", "height": 2.7,
    "rooms": [
      { "name": "客廳", "x": 0, "y": 0, "w": 5.2, "d": 4.0, "floorMat": "wood", "area": "living_room" },
      { "name": "睡房", "x": 0, "y": 4.0, "w": 3.4, "d": 3.0, "floorMat": "carpet" }
    ],
    "doors": [{ "between": ["客廳", "睡房"] }],
    "windows": [{ "at": [2.6, 0], "w": 2.0 }],
    "furniture": [{ "kind": "sofa", "x": 2.6, "y": 3.2, "rot": 180 }],
    "devices": [{ "entity": "light.living_room", "x": 2.6, "y": 2.0, "z": 2.5 }]
  }]
}
```

`samples/` 入面有試用檔：`roomplan-sample.usdz`、`roomplan-bedroom.json`（模擬 iPhone 掃描，係按 RoomPlan 結構自己整嘅，唔係真機掃描）同 `plan-sample.dxf`（兩房 CAD）。

## 檔案

```
home/
  index.html        版面 + CSS
  js/app.js         主程式（頁面、側欄、設定、匯入流程）
  js/model.js       資料模型、幾何、復原、示範屋
  js/view3d.js      three.js 3D 視圖
  js/editor2d.js    SVG 2D 編輯器
  js/furniture.js   傢俬目錄同 3D 造型
  js/themes.js      風格 + 太陽位置
  js/devices.js     HA 實體圖示同控制 UI
  js/ha.js          HA WebSocket 連線 + 示範模式
  js/importers.js   各種格式匯入
```

## 限制

- 弧形牆當直牆處理；冇斜天花、冇屋頂。
- 匯入係 BETA：複雜戶型、斜牆、開放式空間，匯入後一定要人手核對。
- 唔做施工圖、報建、承重判定；裝修施工以專業人員圖紙為準。

線上試用：https://unit-plan-two.vercel.app/home/
