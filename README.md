# ChatGPT 對話備份

把 ChatGPT 對話存成檔案。裝一次，之後每則對話右下角都有一顆存檔按鈕。

**安裝說明頁：** https://minijinai75.github.io/chatgpt-chat-exporter/

## 怎麼裝

| 手機 | 需要的管理器 | 瀏覽器 |
|---|---|---|
| iPhone / iPad | [Stay](https://apps.apple.com/app/id1591620171) | Safari |
| Android | [Tampermonkey（竄改猴）](https://addons.mozilla.org/zh-TW/android/addon/tampermonkey/) | Firefox 或 Kiwi Browser |

**Android 要注意**：手機版 Chrome 裝不了擴充功能，所以要用 Firefox（附加元件裡直接有竄改猴）或 Kiwi Browser（能裝 Chrome 商店的擴充）。

裝好管理器之後，用同一個瀏覽器打開腳本連結，管理器會跳出安裝畫面：

```
https://gist.github.com/Minijinai75/d9b0a1ba98794731f69db45435738084/raw/chatgpt-export.user.js
```

## 它做什麼

打開任何 ChatGPT 對話，右下角出現兩顆按鈕——上面選格式（TXT／MD），下面「存對話」開始存檔。

- 走 ChatGPT 官方 API 取內容，**不受「捲到哪才載到哪」影響**，長對話也拿得完整
- 全程在自己的裝置上跑，沒有任何內容被送到其他地方
- GPTs 對話會用那個 GPT 的名字當說話者，不是泛稱的 ChatGPT
- 格式選擇會記住

## 為什麼不做成 iOS 捷徑

原本就是捷徑做的，三次真機測試三次失敗：**捷徑對「在網頁上執行 JavaScript」有時間上限**，
長對話跑不完就被整格判失敗——連錯在哪都拿不到。那個上限是捷徑的規矩，不是 Safari 的；
寫成使用者腳本就沒有它，而且同一份腳本 Android 也能用。

## 檔案

| 檔案 | 是什麼 |
|---|---|
| `index.html` | 安裝說明頁（GitHub Pages） |
| `chatgpt-export.user.js` | 腳本副本，與 gist 同步 |
| `img/` | 說明頁用的實機截圖 |

**腳本正本在 gist**（安裝連結指向那裡，改版後使用者會拿到新版）：
https://gist.github.com/Minijinai75/d9b0a1ba98794731f69db45435738084

本 repo 的副本是給人閱讀與備份用的；要改腳本請改 gist，再把副本同步回來，別讓兩邊分岔。

## 回報問題

存下來的檔案最上面有一行 `腳本: userscript v?.?.?`，回報時附上那行。

## 授權

MIT
