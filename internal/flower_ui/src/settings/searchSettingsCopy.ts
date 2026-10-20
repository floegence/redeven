export type SearchSettingsCopy = Readonly<{
  fetchLabel: string; fetchDirect: string; fetchDeepSeek: string; deepSeekSearchHint: string; deepSeekCostHint: string; deepSeekFetchHint: string;
  searchProviderHint: string; searchModelHint: string; searchProviderOff: string; searchModelOff: string;
  searchRecommendedOn: string; searchRecommendedOff: string; searchConfigure: string;
  settingsCloseSaving: string; settingsSavePending: string; settingsSaveTimedOut: string; retryTimedOut: string;
}>;

const messages: Record<string, readonly string[]> = {
  'en-US': ["Enable web search for the model too.", "Requires provider search. Reset to defaults restores the recommendation.", 'Provider search is off. Model preferences are saved but inactive.', 'Model search is off.', 'Recommended: on.', 'Recommended: off.', 'Configure current provider', "Close", "Saving continues after you close this dialog.", "Saving timed out. The settings may have been saved. Reopen settings to check before trying again.", "The retry response timed out. The turn may have started. Check the conversation before retrying."],
  'zh-CN': ["需同时开启模型的网页搜索。", "需开启模型提供商的网页搜索；恢复默认会还原推荐值。", '模型提供商搜索已关闭。模型偏好会保存，但暂不生效。', '模型搜索已关闭。', '推荐：开启。', '推荐：关闭。', '配置当前模型提供商', "关闭", "关闭此窗口后，保存仍会继续。", "保存超时，设置可能已经保存。请重新打开设置确认后再尝试。", "重试响应超时，该轮可能已经启动。请确认会话状态后再重试。"],
  'zh-TW': ["也需開啟模型的網頁搜尋。", "需開啟模型供應商的網頁搜尋；還原預設會恢復建議值。", '模型供應商搜尋已關閉。模型偏好會儲存，但暫不生效。', '模型搜尋已關閉。', '建議：開啟。', '建議：關閉。', '設定目前的模型供應商', "關閉", "關閉此視窗後，儲存仍會繼續。", "儲存逾時，設定可能已經儲存。請重新開啟設定確認後再試。", "重試回應逾時，該輪可能已經啟動。請確認對話狀態後再重試。"],
  'ja-JP': ["モデルのウェブ検索もオンにしてください。", "プロバイダーの検索をオンにしてください。既定値に戻すと推奨設定に戻ります。", 'プロバイダーの検索はオフです。モデルの設定は保存されますが、現在は無効です。', 'モデルの検索はオフです。', '推奨：オン。', '推奨：オフ。', '現在のプロバイダーを設定', "閉じる", "このダイアログを閉じた後も保存は続行されます。", "保存がタイムアウトしました。設定は保存済みの可能性があります。設定を開き直して確認してから再試行してください。", "再試行の応答がタイムアウトしました。ターンは開始済みの可能性があります。会話の状態を確認してから再試行してください。"],
  'ko-KR': ["모델의 웹 검색도 켜야 합니다.", "공급자 검색을 켜야 합니다. 기본값으로 재설정하면 권장 설정으로 돌아갑니다.", '공급자 검색이 꺼져 있습니다. 모델 설정은 저장되지만 현재 적용되지 않습니다.', '모델 검색이 꺼져 있습니다.', '권장: 켜기.', '권장: 끄기.', '현재 공급자 설정', "닫기", "이 대화 상자를 닫아도 저장은 계속됩니다.", "저장 시간이 초과되었습니다. 설정이 저장되었을 수 있습니다. 설정을 다시 열어 확인한 후 다시 시도하세요.", "재시도 응답 시간이 초과되었습니다. 턴이 시작되었을 수 있습니다. 대화 상태를 확인한 후 다시 시도하세요."],
  'de-DE': ["Aktivieren Sie auch die Websuche des Modells.", "Erfordert die Anbietersuche. Zurücksetzen stellt die Empfehlung wieder her.", 'Die Anbietersuche ist aus. Modellpräferenzen werden gespeichert, sind aber inaktiv.', 'Die Modellsuche ist aus.', 'Empfohlen: ein.', 'Empfohlen: aus.', 'Aktuellen Anbieter konfigurieren', "Schließen", "Das Speichern wird nach dem Schließen dieses Dialogs fortgesetzt.", "Zeitüberschreitung beim Speichern. Die Einstellungen wurden möglicherweise gespeichert. Öffnen Sie die Einstellungen erneut und prüfen Sie sie vor einem weiteren Versuch.", "Zeitüberschreitung bei der Antwort auf den Wiederholungsversuch. Der Zug wurde möglicherweise gestartet. Prüfen Sie die Unterhaltung vor einem weiteren Versuch."],
  'fr-FR': ["Activez aussi la recherche web du modèle.", "Nécessite la recherche du fournisseur. Le rétablissement des valeurs par défaut restaure la recommandation.", 'La recherche du fournisseur est désactivée. Les préférences du modèle sont enregistrées mais inactives.', 'La recherche du modèle est désactivée.', 'Recommandé : activé.', 'Recommandé : désactivé.', 'Configurer le fournisseur actuel', "Fermer", "L’enregistrement continue après la fermeture de cette fenêtre.", "Le délai d’enregistrement a expiré. Les paramètres ont peut-être été enregistrés. Rouvrez les paramètres pour vérifier avant de réessayer.", "Le délai de réponse à la relance a expiré. Le tour a peut-être commencé. Vérifiez la conversation avant de réessayer."],
  'it-IT': ["Attiva anche la ricerca web del modello.", "Richiede la ricerca del fornitore. Il ripristino dei valori predefiniti ripristina la raccomandazione.", 'La ricerca del fornitore è disattivata. Le preferenze del modello vengono salvate ma sono inattive.', 'La ricerca del modello è disattivata.', 'Consigliato: attivo.', 'Consigliato: disattivo.', 'Configura il fornitore attuale', "Chiudi", "Il salvataggio continua dopo la chiusura di questa finestra.", "Il salvataggio è scaduto. Le impostazioni potrebbero essere state salvate. Riapri le impostazioni per verificare prima di riprovare.", "La risposta al nuovo tentativo è scaduta. Il turno potrebbe essere iniziato. Controlla la conversazione prima di riprovare."],
  'es-ES': ["Activa también la búsqueda web del modelo.", "Requiere la búsqueda del proveedor. Restablecer los valores predeterminados restaura la recomendación.", 'La búsqueda del proveedor está desactivada. Las preferencias del modelo se guardan pero están inactivas.', 'La búsqueda del modelo está desactivada.', 'Recomendado: activado.', 'Recomendado: desactivado.', 'Configurar el proveedor actual', "Cerrar", "El guardado continúa después de cerrar este diálogo.", "El guardado agotó el tiempo de espera. Es posible que los ajustes se hayan guardado. Vuelve a abrirlos para comprobarlo antes de reintentar.", "La respuesta al reintento agotó el tiempo de espera. Es posible que el turno haya comenzado. Comprueba la conversación antes de reintentar."],
  'pt-BR': ["Ative também a pesquisa na web do modelo.", "Requer a pesquisa do provedor. Restaurar os padrões restaura a recomendação.", 'A pesquisa do provedor está desativada. As preferências do modelo são salvas, mas estão inativas.', 'A pesquisa do modelo está desativada.', 'Recomendado: ativado.', 'Recomendado: desativado.', 'Configurar o provedor atual', "Fechar", "O salvamento continua após fechar esta janela.", "O tempo de salvamento esgotou. As configurações podem ter sido salvas. Reabra as configurações para conferir antes de tentar novamente.", "O tempo de resposta da nova tentativa esgotou. O turno pode ter começado. Confira a conversa antes de tentar novamente."],
  'ru-RU': ["Включите также поиск для модели.", "Требуется поиск поставщика. Сброс настроек восстанавливает рекомендацию.", 'Поиск поставщика выключен. Настройки модели сохраняются, но не действуют.', 'Поиск модели выключен.', 'Рекомендуется: включено.', 'Рекомендуется: выключено.', 'Настроить текущего поставщика', "Закрыть", "Сохранение продолжится после закрытия этого окна.", "Время сохранения истекло. Настройки могли сохраниться. Откройте настройки заново и проверьте их перед повторной попыткой.", "Время ожидания ответа на повтор истекло. Ход мог уже начаться. Проверьте диалог перед новой попыткой."],
};

const webServiceMessages: Record<string, readonly string[]> = {
  "en-US": [
    "Page reader",
    "Direct",
    "DeepSeek API",
    "Searches the web through this connection; service support is required.",
    "Additional charges may apply.",
    "DeepSeek sends page URLs to this connection; some search results require it."
  ],
  "zh-CN": [
    "网页读取方式",
    "直接读取",
    "DeepSeek API",
    "通过此连接搜索网页，需接入服务支持。",
    "可能产生额外费用。",
    "DeepSeek 将网页地址发送至此连接读取；部分搜索结果需要此方式。"
  ],
  "zh-TW": [
    "網頁讀取方式",
    "直接讀取",
    "DeepSeek API",
    "透過此連線搜尋網頁，需連線服務支援。",
    "可能產生額外費用。",
    "DeepSeek 將網頁網址傳送至此連線讀取；部分搜尋結果需要此方式。"
  ],
  "ja-JP": [
    "ページの読み取り方法",
    "直接取得",
    "DeepSeek API",
    "この接続でウェブ検索します。接続先の対応が必要です。",
    "追加料金が発生する場合があります。",
    "DeepSeek はページの URL をこの接続に送信して読み取ります。一部の検索結果にはこの方法が必要です。"
  ],
  "ko-KR": [
    "페이지 읽기 방식",
    "직접 읽기",
    "DeepSeek API",
    "이 연결로 웹을 검색합니다. 연결된 서비스에서 지원해야 합니다.",
    "추가 요금이 발생할 수 있습니다.",
    "DeepSeek는 페이지 URL을 이 연결로 보내 읽습니다. 일부 검색 결과에는 이 방식이 필요합니다."
  ],
  "de-DE": [
    "Seitenabruf",
    "Direkt",
    "DeepSeek API",
    "Sucht im Web über diese Verbindung; der Dienst muss dies unterstützen.",
    "Es können zusätzliche Kosten entstehen.",
    "DeepSeek sendet Seiten-URLs an diese Verbindung; einige Suchergebnisse erfordern dies."
  ],
  "fr-FR": [
    "Lecture des pages",
    "Directe",
    "DeepSeek API",
    "Recherche sur le web via cette connexion, si le service le permet.",
    "Des frais supplémentaires peuvent s’appliquer.",
    "DeepSeek envoie les URL des pages à cette connexion ; certains résultats de recherche l’exigent."
  ],
  "it-IT": [
    "Lettura delle pagine",
    "Diretta",
    "DeepSeek API",
    "Cerca sul web tramite questa connessione, se il servizio lo supporta.",
    "Potrebbero essere applicati costi aggiuntivi.",
    "DeepSeek invia gli URL delle pagine a questa connessione; alcuni risultati di ricerca lo richiedono."
  ],
  "es-ES": [
    "Lectura de páginas",
    "Directa",
    "DeepSeek API",
    "Busca en la web mediante esta conexión, si el servicio lo admite.",
    "Pueden aplicarse cargos adicionales.",
    "DeepSeek envía las URL de las páginas a esta conexión; algunos resultados de búsqueda lo requieren."
  ],
  "pt-BR": [
    "Leitura de páginas",
    "Direta",
    "DeepSeek API",
    "Pesquisa na web por esta conexão, se o serviço oferecer suporte.",
    "Pode haver cobranças adicionais.",
    "O DeepSeek envia URLs das páginas para esta conexão; alguns resultados de pesquisa exigem esse método."
  ],
  "ru-RU": [
    "Чтение страниц",
    "Напрямую",
    "DeepSeek API",
    "Ищет в интернете через это подключение, если сервис поддерживает поиск.",
    "Возможна дополнительная плата.",
    "DeepSeek отправляет URL страниц через это подключение; для некоторых результатов поиска нужен этот способ."
  ]
};

export function searchSettingsCopy(locale: string): SearchSettingsCopy {
  const [searchProviderHint, searchModelHint, searchProviderOff, searchModelOff, searchRecommendedOn, searchRecommendedOff, searchConfigure, settingsCloseSaving, settingsSavePending, settingsSaveTimedOut, retryTimedOut] = messages[locale] ?? messages['en-US'];
  const [fetchLabel, fetchDirect, fetchDeepSeek, deepSeekSearchHint, deepSeekCostHint, deepSeekFetchHint] = webServiceMessages[locale] ?? webServiceMessages['en-US'];
  return { fetchLabel, fetchDirect, fetchDeepSeek, deepSeekSearchHint, deepSeekCostHint, deepSeekFetchHint, searchProviderHint, searchModelHint, searchProviderOff, searchModelOff, searchRecommendedOn, searchRecommendedOff, searchConfigure, settingsCloseSaving, settingsSavePending, settingsSaveTimedOut, retryTimedOut };
}
