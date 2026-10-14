'use strict';

// 実装時に使う（現時点では未使用）
const { createLiveEvent } = require('../events/eventFactory');

/**
 * TikTok 実イベントの受信アダプタ（未実装）。
 *
 * 調査結果（docs/integration-research.md）：
 *  - 調査時点で、LIVE のコメント・ギフトを取得する公式 API は提供されていない。
 *  - 非公式ライブラリ（内部通信の解析）や、それを使う中継サービスは、利用規約第5条で禁止されている
 *    「自動化されたスクリプトによる情報収集」「技術の解明」「アクセス制限措置の回避」に該当する可能性があるため使わない。
 *
 * 公式の手段、または TikTok の書面による許可が得られた場合のみ、ここに実装する。
 * 実装する場合の約束：
 *  - 受信したイベントは createLiveEvent() で正規化し、router.handle() に渡すこと（表示前のサニタイズはルーター側で行う）
 *  - 認証情報は .env から読み込み、ソースコードに書かないこと
 *  - CAPTCHA の自動解決など、アクセス制限を回避する処理は実装しないこと
 *  - 視聴者 ID はハッシュ化して扱い、本文をログに残さないこと
 *
 * @param {{router: object, config: object, log: object}} _deps
 * @returns {{stop: () => void}}
 */
function startLiveSource(_deps) {
  throw new Error('実連携は未実装です（公式の手段が確認できていないため）。シミュレーションモードで動作しています。');
}

module.exports = { startLiveSource };
