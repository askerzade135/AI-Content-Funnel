import React, { createContext, useContext, useMemo, useState } from 'react';

export type AppLocale = 'ru' | 'en';

const STORAGE_KEY = 'acf:language';

const detectBrowserLocale = (): AppLocale => {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
};

const getInitialLocale = (): AppLocale => {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {}
  return detectBrowserLocale();
};

const messages = {
  en: {
    'nav.today': 'Today',
    'nav.discover': 'Discover',
    'nav.ideas': 'Ideas',
    'nav.scripts': 'Scripts',
    'nav.calendar': 'Calendar',
    'nav.settings': 'Settings',
    'nav.more': 'More',
    'nav.usage': 'Usage',
    'nav.active': 'Active',
    'nav.accountSettings': 'Account settings',
    'nav.unlock': 'Complete Taste Training to unlock',

    'settings.title': 'Settings',
    'settings.subtitle': 'Personalize Radar, manage content sources and connect services.',
    'settings.personalization': 'Personalization',
    'settings.sources': 'Sources',
    'settings.integrations': 'Integrations',
    'settings.aiUsage': 'AI & Usage',
    'settings.language': 'Language',
    'settings.languageHint': 'Used across the product interface.',
    'settings.russian': 'Русский',
    'settings.english': 'English',
    'settings.tuneRadar': 'Tune Radar',
    'settings.tuneRadarHint': 'Change topics, goals, formats, angles, exclusions and reference content without resetting your feedback history.',

    'today.morning': 'Good morning',
    'today.afternoon': 'Good afternoon',
    'today.evening': 'Good evening',
    'today.subtitle': 'Here’s what Radar prepared for you today.',
    'today.updated': 'Updated',
    'today.syncing': 'Radar is syncing',
    'today.newIdeas': 'new ideas',
    'today.needsReview': 'need review',
    'today.publicationsToday': 'publications today',
    'today.newSignals': 'new signals',
    'today.focus': "Today's focus",
    'today.focusCount': '{count} actions will move your content forward',
    'today.noActions': 'No required actions for today',
    'today.openIdea': 'Open idea',
    'today.reviewScript': 'Review script',
    'today.caughtUp': 'You’re caught up for today',
    'today.caughtUpHint': 'Explore new ideas or keep training Radar.',
    'today.exploreIdeas': 'Explore ideas',
    'today.upcoming': 'Upcoming',
    'today.upcomingHint': 'Your next scheduled publications.',
    'today.viewCalendar': 'View calendar',
    'today.noUpcoming': 'Nothing scheduled yet',
    'today.openCalendar': 'Open calendar',
    'today.recommended': 'Recommended next',
    'today.recommendedHint': 'Ideas that best match your profile.',
    'today.seeAllIdeas': 'See all ideas',
    'today.whyPicked': 'Why Radar picked this:',
    'today.noRecommendations': 'No new recommendations yet. Refresh Radar or add new interests.',
    'today.improve': 'Improve your Radar',
    'today.signalsLearned': '{count} signals learned',
    'today.moreInteract': 'The more you interact, the better the ideas.',
    'today.trainRadar': 'Train Radar',
    'today.scheduled': 'Scheduled',

    'calendar.plan': 'Publishing plan',
    'calendar.title': 'Calendar',
    'calendar.subtitle': 'Scheduled Content Radar publications. Google Calendar sync is optional.',
    'calendar.scheduled': '{count} scheduled',
    'calendar.previousMonth': 'Previous month',
    'calendar.nextMonth': 'Next month',
    'calendar.days': 'Mon|Tue|Wed|Thu|Fri|Sat|Sun',
    'calendar.more': '+{count} more',
    'calendar.upcoming': 'Upcoming',
    'calendar.publication': 'Publication',
    'calendar.none': 'No scheduled publications.',

    'scripts.workspace': 'Production workspace',
    'scripts.title': 'Scripts',
    'scripts.subtitle': 'Turn ideas into great content. Review, edit, schedule and publish.',
    'scripts.search': 'Search scripts...',
    'scripts.newScript': 'New script',
    'scripts.all': 'All',
    'scripts.needsReview': 'Needs review',
    'scripts.approved': 'Approved',
    'scripts.scheduled': 'Scheduled',
    'scripts.published': 'Published',
    'scripts.archived': 'Archived',
    'scripts.sortUpdated': 'Sort: Updated',
    'scripts.sortNewest': 'Sort: Newest',
    'scripts.sortStatus': 'Sort: Status',
    'scripts.loading': 'Loading scripts…',
    'scripts.nothingFound': 'Nothing found',
    'scripts.noScripts': 'No scripts yet',
    'scripts.trySearch': 'Try another search or status filter.',
    'scripts.generateHint': 'Generate a script from one of your Ideas to start the production workflow.',
    'scripts.goIdeas': 'Go to Ideas',
    'scripts.fromIdea': 'From idea',
    'scripts.exported': 'Exported',
    'scripts.version': 'Version',
    'scripts.updated': 'Updated',
    'scripts.approve': 'Approve',
    'scripts.schedule': 'Schedule',
    'scripts.regenerate': 'Regenerate',
    'scripts.copy': 'Copy',
    'scripts.export': 'Export',
    'scripts.archive': 'Archive',
    'scripts.cancel': 'Cancel',
    'scripts.saveVersion': 'Save version',
    'scripts.syncGoogleCalendar': 'Sync to Google Calendar',
    'scripts.saveSchedule': 'Save schedule',
    'scripts.removeSchedule': 'Remove schedule',
    'scripts.sourceTitle': 'Source & rationale',
    'scripts.sourceSubtitle': 'Original idea, source content and why this matters.',
    'scripts.historyTitle': 'Feedback & history',
    'scripts.historySubtitle': 'Comments, version history and changes.',
    'scripts.publishingTitle': 'Publishing',
    'scripts.publishingSubtitle': 'Schedule, platforms and publishing state.',
    'scripts.angle': 'Angle',
    'scripts.openSource': 'Open source',
    'scripts.noSource': 'No linked source idea.',
    'scripts.noFeedback': 'No feedback yet.',
    'scripts.reviewStage': 'Review',
    'scripts.approvedStage': 'Approved',
    'scripts.scheduledStage': 'Scheduled',
    'scripts.publishedStage': 'Published',
    'scripts.platform': 'Platform',
    'scripts.lastExport': 'Last export',
    'scripts.markPublished': 'Mark published',
    'scripts.undoPublished': 'Undo published',
    'scripts.loadError': 'Could not load script',
  },
  ru: {
    'nav.today': 'Сегодня',
    'nav.discover': 'Обзор',
    'nav.ideas': 'Идеи',
    'nav.scripts': 'Сценарии',
    'nav.calendar': 'Календарь',
    'nav.settings': 'Настройки',
    'nav.more': 'Ещё',
    'nav.usage': 'Использование',
    'nav.active': 'Активно',
    'nav.accountSettings': 'Настройки аккаунта',
    'nav.unlock': 'Завершите обучение вкуса, чтобы открыть',

    'settings.title': 'Настройки',
    'settings.subtitle': 'Настройте Radar, источники контента и подключённые сервисы.',
    'settings.personalization': 'Персонализация',
    'settings.sources': 'Источники',
    'settings.integrations': 'Интеграции',
    'settings.aiUsage': 'AI и лимиты',
    'settings.language': 'Язык',
    'settings.languageHint': 'Используется во всём интерфейсе продукта.',
    'settings.russian': 'Русский',
    'settings.english': 'English',
    'settings.tuneRadar': 'Настройка Radar',
    'settings.tuneRadarHint': 'Меняйте темы, цели, форматы, углы, исключения и референсы без сброса истории обратной связи.',

    'today.morning': 'Доброе утро',
    'today.afternoon': 'Добрый день',
    'today.evening': 'Добрый вечер',
    'today.subtitle': 'Вот что Radar подготовил для тебя сегодня.',
    'today.updated': 'Обновлено',
    'today.syncing': 'Radar синхронизируется',
    'today.newIdeas': 'новых идей',
    'today.needsReview': 'ждут проверки',
    'today.publicationsToday': 'публикаций сегодня',
    'today.newSignals': 'новых сигналов',
    'today.focus': 'Фокус на сегодня',
    'today.focusCount': '{count} действия реально продвинут контент вперёд',
    'today.noActions': 'На сегодня обязательных действий нет',
    'today.openIdea': 'Открыть идею',
    'today.reviewScript': 'Проверить сценарий',
    'today.caughtUp': 'На сегодня всё разобрано',
    'today.caughtUpHint': 'Можно перейти к новым идеям или продолжить обучать Radar.',
    'today.exploreIdeas': 'Посмотреть идеи',
    'today.upcoming': 'Ближайшие публикации',
    'today.upcomingHint': 'Следующие публикации из контент-плана.',
    'today.viewCalendar': 'Открыть календарь',
    'today.noUpcoming': 'Пока ничего не запланировано',
    'today.openCalendar': 'Открыть календарь',
    'today.recommended': 'Рекомендовано дальше',
    'today.recommendedHint': 'Идеи, которые лучше всего совпадают с твоим профилем.',
    'today.seeAllIdeas': 'Все идеи',
    'today.whyPicked': 'Почему Radar выбрал это:',
    'today.noRecommendations': 'Пока нет новых рекомендаций. Обнови Radar или добавь новые интересы.',
    'today.improve': 'Улучшай свой Radar',
    'today.signalsLearned': 'Изучено сигналов: {count}',
    'today.moreInteract': 'Чем больше ты взаимодействуешь, тем лучше становятся идеи.',
    'today.trainRadar': 'Обучить Radar',
    'today.scheduled': 'Запланировано',

    'calendar.plan': 'План публикаций',
    'calendar.title': 'Календарь',
    'calendar.subtitle': 'Запланированные публикации Content Radar. Синхронизация с Google Calendar — опциональна.',
    'calendar.scheduled': 'Запланировано: {count}',
    'calendar.previousMonth': 'Предыдущий месяц',
    'calendar.nextMonth': 'Следующий месяц',
    'calendar.days': 'Пн|Вт|Ср|Чт|Пт|Сб|Вс',
    'calendar.more': '+ ещё {count}',
    'calendar.upcoming': 'Ближайшие',
    'calendar.publication': 'Публикация',
    'calendar.none': 'Нет запланированных публикаций.',

    'scripts.workspace': 'Рабочее пространство',
    'scripts.title': 'Сценарии',
    'scripts.subtitle': 'Превращайте идеи в готовый контент: проверяйте, редактируйте, планируйте и публикуйте.',
    'scripts.search': 'Поиск сценариев...',
    'scripts.newScript': 'Новый сценарий',
    'scripts.all': 'Все',
    'scripts.needsReview': 'Ждут проверки',
    'scripts.approved': 'Одобрены',
    'scripts.scheduled': 'Запланированы',
    'scripts.published': 'Опубликованы',
    'scripts.archived': 'Архив',
    'scripts.sortUpdated': 'Сортировка: обновлённые',
    'scripts.sortNewest': 'Сортировка: новые',
    'scripts.sortStatus': 'Сортировка: статус',
    'scripts.loading': 'Загружаю сценарии…',
    'scripts.nothingFound': 'Ничего не найдено',
    'scripts.noScripts': 'Сценариев пока нет',
    'scripts.trySearch': 'Попробуйте другой поиск или фильтр статуса.',
    'scripts.generateHint': 'Создайте сценарий из одной из идей, чтобы начать работу.',
    'scripts.goIdeas': 'Перейти к идеям',
    'scripts.fromIdea': 'Из идеи',
    'scripts.exported': 'Экспортировано',
    'scripts.version': 'Версия',
    'scripts.updated': 'Обновлено',
    'scripts.approve': 'Одобрить',
    'scripts.schedule': 'Запланировать',
    'scripts.regenerate': 'Перегенерировать',
    'scripts.copy': 'Копировать',
    'scripts.export': 'Экспорт',
    'scripts.archive': 'В архив',
    'scripts.cancel': 'Отмена',
    'scripts.saveVersion': 'Сохранить версию',
    'scripts.syncGoogleCalendar': 'Синхронизировать с Google Calendar',
    'scripts.saveSchedule': 'Сохранить расписание',
    'scripts.removeSchedule': 'Убрать из расписания',
    'scripts.sourceTitle': 'Источник и обоснование',
    'scripts.sourceSubtitle': 'Исходная идея, источник и почему это важно.',
    'scripts.historyTitle': 'Обратная связь и история',
    'scripts.historySubtitle': 'Комментарии, версии и изменения.',
    'scripts.publishingTitle': 'Публикация',
    'scripts.publishingSubtitle': 'Расписание, платформы и статус публикации.',
    'scripts.angle': 'Угол',
    'scripts.openSource': 'Открыть источник',
    'scripts.noSource': 'Нет связанной исходной идеи.',
    'scripts.noFeedback': 'Обратной связи пока нет.',
    'scripts.reviewStage': 'Проверка',
    'scripts.approvedStage': 'Одобрено',
    'scripts.scheduledStage': 'Запланировано',
    'scripts.publishedStage': 'Опубликовано',
    'scripts.platform': 'Платформа',
    'scripts.lastExport': 'Последний экспорт',
    'scripts.markPublished': 'Отметить опубликованным',
    'scripts.undoPublished': 'Отменить публикацию',
    'scripts.loadError': 'Не удалось загрузить сценарий',
  },
} as const;

type MessageKey = keyof typeof messages.en;

interface I18nContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [locale, setLocaleState] = useState<AppLocale>(getInitialLocale);

  const setLocale = (next: AppLocale) => {
    setLocaleState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch {}
  };

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, vars) => {
      let value = messages[locale][key] || messages.en[key] || key;
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          value = value.split(`{${name}}`).join(String(replacement));
        }
      }
      return value;
    },
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
};
