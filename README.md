# かたちづくり（仮）

子供向け3Dプリンターワークショップ用の、ブラウザで動くかんたんモデリングツールです。
図形と文字を置いて、大きさ・厚さ・角度を変え、3Dプリント用の STL ファイルを書き出せます。
仕様は [SPEC.md](./SPEC.md) を参照してください。

## 使い方（開発）

```bash
npm install
npm run dev      # 開発用サーバー (http://localhost:5173)
npm run build    # dist/ に公開用ファイルを作成
npm run preview  # 作成したファイルを確認 (http://localhost:4173)
```

## GitHub Pages で公開する

1. このフォルダを GitHub リポジトリに push する（ブランチ `main`）
2. リポジトリの Settings → Pages → Source を「GitHub Actions」にする
3. push のたびに `.github/workflows/deploy.yml` が自動でビルド・公開する

一度ページを開くと、フォントを含むすべてのファイルがブラウザに保存され、以後はネットなしでも動きます（PWA）。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `src/config.js` | **図形・土台テンプレート・色・制限値の設定**。図形の追加や変更はここだけ編集する |
| `src/geometry.js` | 2D輪郭の押し出し、和・差の計算（manifold-3d）、文字の輪郭化（opentype.js） |
| `src/state.js` | 作品データ、元に戻す／やり直し、各操作 |
| `src/viewer.js` | 3D表示（Three.js）、マウス・タッチ操作、ハンドル |
| `src/io.js` | 作品ファイルの保存・読み込み、STL書き出し |
| `src/destination.js` | STLの保存先（ダウンロード / Google ドライブ / フォルダ）への送信 |
| `src/dialogs.js` | 送信確認・保存先設定のダイアログ |
| `gas/` | Google ドライブ用の受け取りスクリプトと設定手順 |
| `src/main.js` | 画面（ツールバー・図形パネル・プロパティ）の組み立て |
| `src/icons.js` | アイコン |
| `public/fonts/` | 文字用フォント（M PLUS Rounded 1c Bold, SIL OFL 1.1） |

## 図形を追加するには

`src/config.js` の `SHAPES` に1行追加します。輪郭は「幅1×奥行1、中心が原点」の範囲の点の並びで書きます。
アイコンは輪郭から自動で作られます。

```js
{ id: 'hexagon', name: 'ろっかっけい', contours: [circle(0.5, 6)], size: [20, 20, 2] },
```

## 操作

| 操作 | マウス | タッチ | キーボード |
|---|---|---|---|
| 図形を置く | 右のパネルをクリック | タップ | |
| 選ぶ / 動かす | 左クリック / 左ドラッグ | タップ / ドラッグ | 矢印キー（Shiftで5mm） |
| いくつも選ぶ | 何もない所から左ドラッグで枠を描く / Shift+クリック | 「いくつも えらぶ」をオンにして、1本指で枠を描く / タップ | |
| 選択をやめる | 何もない所をクリック | 何もない所をタップ | Esc |
| 大きさ | 四隅・辺の白い四角をドラッグ | 同じ | 数値入力 |
| 厚さ | 右奥の白い三角をドラッグ / ＋− | 同じ | 数値入力 |
| 回転 | 左奥の白い丸をドラッグ | 同じ | 数値入力 |
| 視点を回す | 右ドラッグ | 1本指ドラッグ（何もない所） | |
| 平行移動 | 中ドラッグ / Shift+右ドラッグ | 2本指 | |
| 拡大・縮小 | ホイール | 2本指 | |
| 元に戻す / やり直し | | | Ctrl+Z / Ctrl+Y |
| コピー / けす / まとめる | | | Ctrl+D / Delete / Ctrl+G |

ハンドルをドラッグしている間は、そばに数値（大きさ・厚さ・角度）が表示されます。

## 3Dプリント用ファイルの保存先

右上の「3Dプリントに おくる」を押すと、確認のあと、設定済みの保存先に STL が送られます。

- 保存先の設定: 画面右下の歯車を **2秒間長押し**（先生用）
  - この端末のダウンロードフォルダ（未設定のとき）
  - Google ドライブ（受け取り用URL）… 設定手順は [gas/README.md](./gas/README.md)
  - このパソコンのフォルダ（共有フォルダも可。Chrome のパソコン版のみ）
- 送れなかったときは、代わりにこの端末のダウンロードフォルダに保存します
- ダウンロード時に保存場所を聞かれる場合は、Chrome の設定「ダウンロード前に各ファイルの保存場所を確認する」をオフにしてください

## 使用ライブラリ

- [Three.js](https://threejs.org/) (MIT)
- [manifold-3d](https://github.com/elalish/manifold) (Apache-2.0)
- [opentype.js](https://opentype.js.org/) (MIT)
- [M PLUS Rounded 1c](https://fonts.google.com/specimen/M+PLUS+Rounded+1c) (SIL OFL 1.1)
