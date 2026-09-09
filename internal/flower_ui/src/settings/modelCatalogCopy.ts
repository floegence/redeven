export type ModelCatalogCopy = Readonly<{
  search: string; selected: string; selectAll: string; clearAll: string; refresh: string;
  loading: string; empty: string; preview: string; experimental: string;
  unavailable: string; edit: string; reset: string; optionalKey: string;
}>;

const messages: Record<string, readonly string[]> = {
  'en-US': ['Search models', '{count} selected', 'Select all', 'Clear selection', 'Refresh models', 'Loading models…', 'No matching models', 'Preview', 'Experimental', 'The current model is unavailable. Choose another model.', 'Edit model', 'Reset to defaults', "API key optional"],
  'zh-CN': ['搜索模型', '已选 {count} 个', '全部勾选', '取消全部', '刷新模型', '正在加载模型…', '没有匹配的模型', '预览版', '实验版', '当前模型不可用，请重新选择模型。', '编辑模型', '恢复默认参数', "API 密钥可选"],
  'zh-TW': ['搜尋模型', '已選 {count} 個', '全部勾選', '取消全部', '重新整理模型', '正在載入模型…', '沒有符合的模型', '預覽版', '實驗版', '目前模型無法使用，請重新選擇模型。', '編輯模型', '還原預設參數', "API 金鑰為選填"],
  'ja-JP': ['モデルを検索', '{count} 件選択中', 'すべて選択', '選択を解除', 'モデルを更新', 'モデルを読み込み中…', '一致するモデルがありません', 'プレビュー', '試験版', '現在のモデルは利用できません。別のモデルを選択してください。', 'モデルを編集', '既定値に戻す', "API キーは任意"],
  'ko-KR': ['모델 검색', '{count}개 선택됨', '모두 선택', '선택 해제', '모델 새로고침', '모델 불러오는 중…', '일치하는 모델이 없습니다', '미리 보기', '실험 버전', '현재 모델을 사용할 수 없습니다. 다른 모델을 선택하세요.', '모델 편집', '기본값으로 재설정', "API 키 선택 사항"],
  'de-DE': ['Modelle suchen', '{count} ausgewählt', 'Alle auswählen', 'Auswahl aufheben', 'Modelle aktualisieren', 'Modelle werden geladen…', 'Keine passenden Modelle', 'Vorschau', 'Experimentell', 'Das aktuelle Modell ist nicht verfügbar. Wählen Sie ein anderes Modell.', 'Modell bearbeiten', 'Standardwerte wiederherstellen', "API-Schlüssel optional"],
  'fr-FR': ['Rechercher des modèles', '{count} sélectionnés', 'Tout sélectionner', 'Effacer la sélection', 'Actualiser les modèles', 'Chargement des modèles…', 'Aucun modèle correspondant', 'Aperçu', 'Expérimental', 'Le modèle actuel est indisponible. Choisissez un autre modèle.', 'Modifier le modèle', 'Rétablir les paramètres par défaut', "Clé API facultative"],
  'es-ES': ['Buscar modelos', '{count} seleccionados', 'Seleccionar todos', 'Borrar selección', 'Actualizar modelos', 'Cargando modelos…', 'No hay modelos coincidentes', 'Vista previa', 'Experimental', 'El modelo actual no está disponible. Elige otro modelo.', 'Editar modelo', 'Restablecer valores predeterminados', "Clave API opcional"],
  'pt-BR': ['Buscar modelos', '{count} selecionados', 'Selecionar todos', 'Limpar seleção', 'Atualizar modelos', 'Carregando modelos…', 'Nenhum modelo correspondente', 'Prévia', 'Experimental', 'O modelo atual está indisponível. Escolha outro modelo.', 'Editar modelo', 'Restaurar padrões', "Chave de API opcional"],
  'ru-RU': ['Поиск моделей', 'Выбрано: {count}', 'Выбрать все', 'Снять выделение', 'Обновить модели', 'Загрузка моделей…', 'Подходящих моделей нет', 'Предварительная версия', 'Экспериментальная', 'Текущая модель недоступна. Выберите другую модель.', 'Изменить модель', 'Восстановить настройки', "Ключ API необязателен"],
};

export function modelCatalogCopy(locale: string): ModelCatalogCopy {
  const [search, selected, selectAll, clearAll, refresh, loading, empty, preview, experimental, unavailable, edit, reset, optionalKey] = messages[locale] ?? messages['en-US'];
  return { search, selected, selectAll, clearAll, refresh, loading, empty, preview, experimental, unavailable, edit, reset, optionalKey };
}
