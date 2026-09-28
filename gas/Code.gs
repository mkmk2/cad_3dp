/**
 * かたちづくり: 3Dプリント用ファイル (STL) の受け取りスクリプト
 * Google Apps Script のウェブアプリとして公開し、発行されたURLをツールの「保存先の設定」に入れる。
 * 設定手順は gas/README.md を参照。
 */

// ▼ STL を保存する Google ドライブのフォルダID (フォルダを開いたときのURLの最後の部分)
const FOLDER_ID = 'ここにフォルダIDを入れる';

// 受け付ける最大サイズ (バイト)
const MAX_BYTES = 20 * 1024 * 1024;

// 接続テスト用
function doGet() {
  return json({ ok: true, app: 'cad_3dp' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const name = String(req.name || '');
    // ファイル名は ツールが作る形式 (英数字・ハイフンのみ + .stl) だけ受け付ける
    if (!/^[A-Za-z0-9-]{1,80}\.stl$/.test(name)) return json({ ok: false, error: 'bad name' });

    const bytes = Utilities.base64Decode(String(req.data || ''));
    if (bytes.length < 84 || bytes.length > MAX_BYTES) return json({ ok: false, error: 'bad size' });

    // バイナリSTLの形になっているか確かめる (三角形の数とファイルの大きさが合うか)
    const tri = (bytes[80] & 0xff) | ((bytes[81] & 0xff) << 8) | ((bytes[82] & 0xff) << 16) | ((bytes[83] & 0xff) << 24);
    if (84 + tri * 50 !== bytes.length) return json({ ok: false, error: 'not stl' });

    const blob = Utilities.newBlob(bytes, 'model/stl', name);
    const file = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
    return json({ ok: true, name: file.getName() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
