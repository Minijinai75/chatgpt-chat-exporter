# ChatGPT 對話備份（iOS Safari）

在 iPhone 上把 ChatGPT 對話存成檔案。裝一次，之後每則對話右下角都有一顆存檔按鈕。

**安裝說明頁：** https://minijinai75.github.io/chatgpt-chat-exporter/

## 這是什麼

一支 Safari 使用者腳本（userscript），配 [Stay](https://apps.apple.com/app/id1591620171) 使用。
打開任何 ChatGPT 對話，右下角會出現「存對話」按鈕，按一下把整串對話存成 TXT 或 MD。

- 走 ChatGPT 官方 API 取內容，**不受「捲到哪才載到哪」影響**，長對話也拿得完整
- 全程在自己的裝置上跑，沒有任何內容被送到其他地方
- 格式可切換（TXT / MD），選擇會記住

## 為什麼不做成 iOS 捷徑

原本就是捷徑做的，三次真機測試三次失敗：**捷徑對「在網頁上執行 JavaScript」有時間上限**，
長對話跑不完就被整格判失敗——連錯在哪都拿不到。那個上限是捷徑的規矩，不是 Safari 的；
寫成使用者腳本就沒有它。

## 檔案

| 檔案 | 是什麼 |
|---|---|
| `index.html` | 安裝說明頁（GitHub Pages） |
| `chatgpt-export.user.js` | 腳本副本，與 gist 同步 |

**腳本正本在 gist**（安裝連結指向那裡，改版後使用者會拿到新版）：
https://gist.github.com/Minijinai75/d9b0a1ba98794731f69db45435738084

本 repo 的副本是給人閱讀與備份用的；要改腳本請改 gist，再把副本同步回來，別讓兩邊分岔。

## 回報問題

存下來的檔案最上面有一行 `腳本: userscript v?.?.?`，回報時附上那行。

## 授權

MIT
