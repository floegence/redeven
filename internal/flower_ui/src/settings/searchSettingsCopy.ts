export type SearchSettingsCopy = Readonly<{
  fetchLabel: string; fetchDirect: string; fetchDeepSeek: string; deepSeekSearchHint: string; deepSeekCostHint: string; deepSeekFetchHint: string;
  searchProviderHint: string; searchModelHint: string; searchProviderOff: string; searchModelOff: string;
  searchRecommendedOn: string; searchRecommendedOff: string; searchConfigure: string;
  settingsCloseSaving: string; settingsSavePending: string; settingsSaveTimedOut: string; retryTimedOut: string;
}>;

const messages: Record<string, readonly string[]> = {
  'en-US': ['Controls search for this provider. Both provider and model switches must be on. Changes apply to the next turn or manual retry. An endpoint may reject search even when enabled.', 'Controls search for this model. Both switches must be on. Reset to defaults removes your override and restores the recommendation. Changes apply to the next turn or manual retry; the provider may reject search.', 'Provider search is off. Model preferences are saved but inactive.', 'Model search is off.', 'Recommended: on.', 'Recommended: off.', 'Configure current provider', "Close", "Saving continues after you close this dialog.", "Saving timed out. The settings may have been saved. Reopen settings to check before trying again.", "The retry response timed out. The turn may have started. Check the conversation before retrying."],
  'zh-CN': ['控制此模型提供商的搜索。提供商与模型开关都开启后才生效。更改从下一轮或手动重试生效。即使开启，服务端仍可能拒绝搜索。', '控制此模型的搜索，两个开关都开启后才生效。恢复默认参数会清除显式覆盖并使用推荐值。更改从下一轮或手动重试生效；模型提供商仍可能拒绝搜索。', '模型提供商搜索已关闭。模型偏好会保存，但暂不生效。', '模型搜索已关闭。', '推荐：开启。', '推荐：关闭。', '配置当前模型提供商', "关闭", "关闭此窗口后，保存仍会继续。", "保存超时，设置可能已经保存。请重新打开设置确认后再尝试。", "重试响应超时，该轮可能已经启动。请确认会话状态后再重试。"],
  'zh-TW': ['控制此模型供應商的搜尋。供應商與模型開關皆開啟後才會生效。變更從下一輪或手動重試生效。即使開啟，伺服器仍可能拒絕搜尋。', '控制此模型的搜尋，兩個開關皆開啟後才會生效。還原預設參數會清除明確覆寫並採用建議值。變更從下一輪或手動重試生效；模型供應商仍可能拒絕搜尋。', '模型供應商搜尋已關閉。模型偏好會儲存，但暫不生效。', '模型搜尋已關閉。', '建議：開啟。', '建議：關閉。', '設定目前的模型供應商', "關閉", "關閉此視窗後，儲存仍會繼續。", "儲存逾時，設定可能已經儲存。請重新開啟設定確認後再試。", "重試回應逾時，該輪可能已經啟動。請確認對話狀態後再重試。"],
  'ja-JP': ['このモデルプロバイダーの検索を制御します。プロバイダーとモデルの両方をオンにしてください。変更は次のターンまたは手動の再試行から適用されます。有効でも接続先が検索を拒否する場合があります。', 'このモデルの検索を制御します。両方のスイッチをオンにしてください。既定値に戻すと上書きが削除され、推奨値になります。変更は次のターンまたは手動の再試行から適用されます。プロバイダーが検索を拒否する場合があります。', 'プロバイダーの検索はオフです。モデルの設定は保存されますが、現在は無効です。', 'モデルの検索はオフです。', '推奨：オン。', '推奨：オフ。', '現在のプロバイダーを設定', "閉じる", "このダイアログを閉じた後も保存は続行されます。", "保存がタイムアウトしました。設定は保存済みの可能性があります。設定を開き直して確認してから再試行してください。", "再試行の応答がタイムアウトしました。ターンは開始済みの可能性があります。会話の状態を確認してから再試行してください。"],
  'ko-KR': ['이 모델 공급자의 검색을 제어합니다. 공급자와 모델 스위치를 모두 켜야 합니다. 변경 사항은 다음 턴이나 수동 재시도부터 적용됩니다. 켜져 있어도 엔드포인트에서 검색을 거부할 수 있습니다.', '이 모델의 검색을 제어합니다. 두 스위치를 모두 켜야 합니다. 기본값으로 재설정하면 재정의를 지우고 권장값을 복원합니다. 변경 사항은 다음 턴이나 수동 재시도부터 적용되며 공급자가 검색을 거부할 수 있습니다.', '공급자 검색이 꺼져 있습니다. 모델 설정은 저장되지만 현재 적용되지 않습니다.', '모델 검색이 꺼져 있습니다.', '권장: 켜기.', '권장: 끄기.', '현재 공급자 설정', "닫기", "이 대화 상자를 닫아도 저장은 계속됩니다.", "저장 시간이 초과되었습니다. 설정이 저장되었을 수 있습니다. 설정을 다시 열어 확인한 후 다시 시도하세요.", "재시도 응답 시간이 초과되었습니다. 턴이 시작되었을 수 있습니다. 대화 상태를 확인한 후 다시 시도하세요."],
  'de-DE': ['Steuert die Suche für diesen Modellanbieter. Anbieter und Modell müssen eingeschaltet sein. Änderungen gelten ab dem nächsten Zug oder manuellen Wiederholungsversuch. Der Endpunkt kann die Suche trotzdem ablehnen.', 'Steuert die Suche für dieses Modell. Beide Schalter müssen eingeschaltet sein. Zurücksetzen entfernt Ihre Überschreibung und stellt die Empfehlung wieder her. Änderungen gelten ab dem nächsten Zug oder manuellen Wiederholungsversuch; der Anbieter kann die Suche ablehnen.', 'Die Anbietersuche ist aus. Modellpräferenzen werden gespeichert, sind aber inaktiv.', 'Die Modellsuche ist aus.', 'Empfohlen: ein.', 'Empfohlen: aus.', 'Aktuellen Anbieter konfigurieren', "Schließen", "Das Speichern wird nach dem Schließen dieses Dialogs fortgesetzt.", "Zeitüberschreitung beim Speichern. Die Einstellungen wurden möglicherweise gespeichert. Öffnen Sie die Einstellungen erneut und prüfen Sie sie vor einem weiteren Versuch.", "Zeitüberschreitung bei der Antwort auf den Wiederholungsversuch. Der Zug wurde möglicherweise gestartet. Prüfen Sie die Unterhaltung vor einem weiteren Versuch."],
  'fr-FR': ['Contrôle la recherche pour ce fournisseur de modèles. Les deux interrupteurs, fournisseur et modèle, doivent être activés. Les modifications prennent effet au prochain tour ou à la prochaine relance manuelle. Le serveur peut néanmoins refuser la recherche.', 'Contrôle la recherche pour ce modèle. Les deux interrupteurs doivent être activés. Le rétablissement des valeurs par défaut supprime votre choix explicite et restaure la recommandation. Les modifications prennent effet au prochain tour ou à la prochaine relance manuelle ; le fournisseur peut refuser la recherche.', 'La recherche du fournisseur est désactivée. Les préférences du modèle sont enregistrées mais inactives.', 'La recherche du modèle est désactivée.', 'Recommandé : activé.', 'Recommandé : désactivé.', 'Configurer le fournisseur actuel', "Fermer", "L’enregistrement continue après la fermeture de cette fenêtre.", "Le délai d’enregistrement a expiré. Les paramètres ont peut-être été enregistrés. Rouvrez les paramètres pour vérifier avant de réessayer.", "Le délai de réponse à la relance a expiré. Le tour a peut-être commencé. Vérifiez la conversation avant de réessayer."],
  'it-IT': ['Controlla la ricerca per questo fornitore di modelli. Entrambi gli interruttori, fornitore e modello, devono essere attivi. Le modifiche si applicano al turno successivo o al nuovo tentativo manuale. Il server potrebbe comunque rifiutare la ricerca.', 'Controlla la ricerca per questo modello. Entrambi gli interruttori devono essere attivi. Il ripristino dei valori predefiniti elimina la scelta esplicita e ripristina il valore consigliato. Le modifiche si applicano al turno successivo o al nuovo tentativo manuale; il fornitore potrebbe rifiutare la ricerca.', 'La ricerca del fornitore è disattivata. Le preferenze del modello vengono salvate ma sono inattive.', 'La ricerca del modello è disattivata.', 'Consigliato: attivo.', 'Consigliato: disattivo.', 'Configura il fornitore attuale', "Chiudi", "Il salvataggio continua dopo la chiusura di questa finestra.", "Il salvataggio è scaduto. Le impostazioni potrebbero essere state salvate. Riapri le impostazioni per verificare prima di riprovare.", "La risposta al nuovo tentativo è scaduta. Il turno potrebbe essere iniziato. Controlla la conversazione prima di riprovare."],
  'es-ES': ['Controla la búsqueda para este proveedor de modelos. Los interruptores del proveedor y del modelo deben estar activados. Los cambios se aplican al siguiente turno o reintento manual. El servidor puede rechazar la búsqueda aunque esté activada.', 'Controla la búsqueda para este modelo. Ambos interruptores deben estar activados. Restablecer los valores predeterminados elimina tu elección explícita y restaura la recomendación. Los cambios se aplican al siguiente turno o reintento manual; el proveedor puede rechazar la búsqueda.', 'La búsqueda del proveedor está desactivada. Las preferencias del modelo se guardan pero están inactivas.', 'La búsqueda del modelo está desactivada.', 'Recomendado: activado.', 'Recomendado: desactivado.', 'Configurar el proveedor actual', "Cerrar", "El guardado continúa después de cerrar este diálogo.", "El guardado agotó el tiempo de espera. Es posible que los ajustes se hayan guardado. Vuelve a abrirlos para comprobarlo antes de reintentar.", "La respuesta al reintento agotó el tiempo de espera. Es posible que el turno haya comenzado. Comprueba la conversación antes de reintentar."],
  'pt-BR': ['Controla a pesquisa deste provedor de modelos. Os interruptores do provedor e do modelo devem estar ativados. As alterações valem no próximo turno ou na nova tentativa manual. O servidor pode rejeitar a pesquisa mesmo quando ativada.', 'Controla a pesquisa deste modelo. Os dois interruptores devem estar ativados. Restaurar os padrões remove sua escolha explícita e restaura a recomendação. As alterações valem no próximo turno ou na nova tentativa manual; o provedor pode rejeitar a pesquisa.', 'A pesquisa do provedor está desativada. As preferências do modelo são salvas, mas estão inativas.', 'A pesquisa do modelo está desativada.', 'Recomendado: ativado.', 'Recomendado: desativado.', 'Configurar o provedor atual', "Fechar", "O salvamento continua após fechar esta janela.", "O tempo de salvamento esgotou. As configurações podem ter sido salvas. Reabra as configurações para conferir antes de tentar novamente.", "O tempo de resposta da nova tentativa esgotou. O turno pode ter começado. Confira a conversa antes de tentar novamente."],
  'ru-RU': ['Управляет поиском для этого поставщика моделей. Переключатели поставщика и модели должны быть включены. Изменения действуют со следующего хода или ручного повтора. Сервер может отклонить поиск даже при включённой настройке.', 'Управляет поиском для этой модели. Оба переключателя должны быть включены. Сброс удаляет явную настройку и восстанавливает рекомендацию. Изменения действуют со следующего хода или ручного повтора; поставщик может отклонить поиск.', 'Поиск поставщика выключен. Настройки модели сохраняются, но не действуют.', 'Поиск модели выключен.', 'Рекомендуется: включено.', 'Рекомендуется: выключено.', 'Настроить текущего поставщика', "Закрыть", "Сохранение продолжится после закрытия этого окна.", "Время сохранения истекло. Настройки могли сохраниться. Откройте настройки заново и проверьте их перед повторной попыткой.", "Время ожидания ответа на повтор истекло. Ход мог уже начаться. Проверьте диалог перед новой попыткой."],
};

const webServiceMessages: Record<string, readonly string[]> = {
  "en-US": [
    "Page reader",
    "Direct",
    "DeepSeek API",
    "Flash uses the Search API; Pro uses hosted search. Both use this connection. Unknown models have no search.",
    "Search and Fetch APIs each cost $0.75 per 1,000 successful non-empty requests. Provider pricing applies to hosted search.",
    "Direct remains the default. DeepSeek sends public page URLs to this connection and returns Markdown. Search off does not disable page reading. Changes apply to the next turn; recovery keeps the original source."
  ],
  "zh-CN": [
    "网页读取方式",
    "直接读取",
    "DeepSeek API",
    "Flash 使用 Search API，Pro 使用托管搜索，均绑定此连接。未知模型不提供搜索。",
    "Search 与 Fetch API 分别按每 1,000 次成功且非空请求收取 0.75 美元。托管搜索以模型提供商定价为准。",
    "默认直接读取。选择 DeepSeek 后，公开网页地址将发送给此连接并返回 Markdown。关闭搜索不影响网页读取。更改从下一轮生效；恢复执行保留原来源。"
  ],
  "zh-TW": [
    "網頁讀取方式",
    "直接讀取",
    "DeepSeek API",
    "Flash 使用 Search API，Pro 使用託管搜尋，皆綁定此連線。未知模型不提供搜尋。",
    "Search 與 Fetch API 各按每 1,000 次成功且非空請求收取 0.75 美元。託管搜尋依模型供應商定價。",
    "預設直接讀取。選擇 DeepSeek 後，公開網頁網址將傳送至此連線並回傳 Markdown。關閉搜尋不影響網頁讀取。變更從下一輪生效；恢復執行保留原來源。"
  ],
  "ja-JP": [
    "ページの読み取り方法",
    "直接取得",
    "DeepSeek API",
    "Flash は Search API、Pro はホスト型検索を使用し、この接続に固定されます。未知のモデルでは検索できません。",
    "Search API と Fetch API はそれぞれ、空でない成功リクエスト 1,000 件あたり 0.75 米ドルです。ホスト型検索はプロバイダーの料金に従います。",
    "既定は直接取得です。DeepSeek を選ぶと公開ページの URL をこの接続に送信し、Markdown を取得します。検索をオフにしてもページ取得は無効になりません。変更は次のターンから適用され、復旧時は元の取得元を保持します。"
  ],
  "ko-KR": [
    "페이지 읽기 방식",
    "직접 읽기",
    "DeepSeek API",
    "Flash는 Search API, Pro는 호스팅 검색을 사용하며 이 연결에 고정됩니다. 알 수 없는 모델은 검색을 지원하지 않습니다.",
    "Search 및 Fetch API는 각각 비어 있지 않은 성공 요청 1,000건당 미화 0.75달러입니다. 호스팅 검색은 공급자 요금이 적용됩니다.",
    "기본값은 직접 읽기입니다. DeepSeek를 선택하면 공개 페이지 URL을 이 연결로 보내 Markdown을 받습니다. 검색을 꺼도 페이지 읽기는 유지됩니다. 변경은 다음 턴부터 적용되며 복구 시 원래 소스를 유지합니다."
  ],
  "de-DE": [
    "Seitenabruf",
    "Direkt",
    "DeepSeek API",
    "Flash verwendet die Search API, Pro die gehostete Suche. Beide sind an diese Verbindung gebunden. Unbekannte Modelle haben keine Suche.",
    "Search API und Fetch API kosten jeweils 0,75 USD pro 1.000 erfolgreiche, nicht leere Anfragen. Für gehostete Suche gelten die Anbieterpreise.",
    "Standard ist der direkte Abruf. DeepSeek sendet öffentliche Seiten-URLs an diese Verbindung und liefert Markdown. Suche ausschalten deaktiviert den Seitenabruf nicht. Änderungen gelten ab dem nächsten Zug; bei Wiederaufnahme bleibt die ursprüngliche Quelle erhalten."
  ],
  "fr-FR": [
    "Lecture des pages",
    "Directe",
    "DeepSeek API",
    "Flash utilise Search API et Pro la recherche hébergée, avec cette connexion. Les modèles inconnus ne disposent pas de recherche.",
    "Search API et Fetch API coûtent chacune 0,75 USD pour 1 000 requêtes réussies non vides. La recherche hébergée suit les tarifs du fournisseur.",
    "La lecture directe reste le choix par défaut. DeepSeek transmet les URL publiques à cette connexion et renvoie du Markdown. Désactiver la recherche ne désactive pas la lecture. Les changements prennent effet au prochain tour ; la reprise conserve la source initiale."
  ],
  "it-IT": [
    "Lettura delle pagine",
    "Diretta",
    "DeepSeek API",
    "Flash usa Search API e Pro la ricerca ospitata, entrambe con questa connessione. I modelli sconosciuti non hanno ricerca.",
    "Search API e Fetch API costano ciascuna 0,75 USD ogni 1.000 richieste riuscite non vuote. Per la ricerca ospitata valgono i prezzi del fornitore.",
    "La lettura diretta resta predefinita. DeepSeek invia gli URL pubblici a questa connessione e restituisce Markdown. Disattivare la ricerca non disattiva la lettura. Le modifiche valgono dal turno successivo; la ripresa mantiene la fonte originale."
  ],
  "es-ES": [
    "Lectura de páginas",
    "Directa",
    "DeepSeek API",
    "Flash usa Search API y Pro la búsqueda alojada, ambas con esta conexión. Los modelos desconocidos no tienen búsqueda.",
    "Search API y Fetch API cuestan cada una 0,75 USD por 1.000 solicitudes correctas no vacías. La búsqueda alojada sigue los precios del proveedor.",
    "La lectura directa sigue siendo la predeterminada. DeepSeek envía las URL públicas a esta conexión y devuelve Markdown. Desactivar la búsqueda no desactiva la lectura. Los cambios se aplican al siguiente turno; la recuperación conserva la fuente original."
  ],
  "pt-BR": [
    "Leitura de páginas",
    "Direta",
    "DeepSeek API",
    "Flash usa a Search API e Pro usa a pesquisa hospedada, ambas nesta conexão. Modelos desconhecidos não têm pesquisa.",
    "Search API e Fetch API custam cada uma US$ 0,75 por 1.000 solicitações bem-sucedidas não vazias. A pesquisa hospedada segue os preços do provedor.",
    "A leitura direta continua como padrão. DeepSeek envia URLs públicas para esta conexão e retorna Markdown. Desativar a pesquisa não desativa a leitura. As alterações valem no próximo turno; a recuperação mantém a fonte original."
  ],
  "ru-RU": [
    "Чтение страниц",
    "Напрямую",
    "DeepSeek API",
    "Flash использует Search API, Pro — встроенный поиск через это подключение. Для неизвестных моделей поиск недоступен.",
    "Search API и Fetch API стоят по 0,75 USD за 1 000 успешных непустых запросов. Для встроенного поиска действуют тарифы поставщика.",
    "По умолчанию страницы читаются напрямую. DeepSeek отправляет публичные URL через это подключение и возвращает Markdown. Отключение поиска не отключает чтение. Изменения действуют со следующего хода; восстановление сохраняет исходный источник."
  ]
};

export function searchSettingsCopy(locale: string): SearchSettingsCopy {
  const [searchProviderHint, searchModelHint, searchProviderOff, searchModelOff, searchRecommendedOn, searchRecommendedOff, searchConfigure, settingsCloseSaving, settingsSavePending, settingsSaveTimedOut, retryTimedOut] = messages[locale] ?? messages['en-US'];
  const [fetchLabel, fetchDirect, fetchDeepSeek, deepSeekSearchHint, deepSeekCostHint, deepSeekFetchHint] = webServiceMessages[locale] ?? webServiceMessages['en-US'];
  return { fetchLabel, fetchDirect, fetchDeepSeek, deepSeekSearchHint, deepSeekCostHint, deepSeekFetchHint, searchProviderHint, searchModelHint, searchProviderOff, searchModelOff, searchRecommendedOn, searchRecommendedOff, searchConfigure, settingsCloseSaving, settingsSavePending, settingsSaveTimedOut, retryTimedOut };
}
