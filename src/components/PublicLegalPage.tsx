import React, { useEffect } from 'react';
import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-react';
import { BrandLockup } from './BrandLogo';
import { useI18n } from '../i18n';

export type PublicLegalPageKind = 'privacy' | 'terms' | 'data-deletion';

interface PublicLegalPageProps {
  kind: PublicLegalPageKind;
}

const EFFECTIVE_DATE = 'September 26, 2026';

export function isPublicLegalPath(pathname: string): PublicLegalPageKind | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/privacy') return 'privacy';
  if (normalized === '/terms') return 'terms';
  if (normalized === '/data-deletion') return 'data-deletion';
  return null;
}

export const PublicLegalPage: React.FC<PublicLegalPageProps> = ({ kind }) => {
  const { locale, setLocale } = useI18n();
  const ru = locale === 'ru';

  useEffect(() => {
    const titles: Record<PublicLegalPageKind, string> = {
      privacy: ru ? 'Политика конфиденциальности — Content Radar' : 'Privacy Policy — Content Radar',
      terms: ru ? 'Условия использования — Content Radar' : 'Terms of Service — Content Radar',
      'data-deletion': ru ? 'Удаление данных — Content Radar' : 'Data Deletion — Content Radar',
    };
    document.title = titles[kind];
    return () => { document.title = 'Content Radar'; };
  }, [kind, ru]);

  const nav = [
    { href: '/privacy', label: ru ? 'Конфиденциальность' : 'Privacy' },
    { href: '/terms', label: ru ? 'Условия' : 'Terms' },
    { href: '/data-deletion', label: ru ? 'Удаление данных' : 'Data deletion' },
  ];

  const shell = (title: string, subtitle: string, body: React.ReactNode) => (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <a href="/" className="inline-flex w-fit items-center" aria-label="Content Radar">
            <BrandLockup compact markClassName="h-9 w-9 p-1.5" />
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex flex-wrap items-center gap-1 text-xs font-semibold text-stone-500" aria-label={ru ? 'Юридическая информация' : 'Legal information'}>
              {nav.map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-2.5 py-2 transition hover:bg-stone-100 hover:text-stone-900 ${window.location.pathname.replace(/\/+$/, '') === item.href ? 'bg-stone-100 text-stone-900' : ''}`}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="ml-auto inline-flex rounded-lg border border-stone-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setLocale('ru')}
                className={`rounded-md px-2 py-1.5 text-[11px] font-semibold ${ru ? 'bg-stone-900 text-white' : 'text-stone-500'}`}
              >
                RU
              </button>
              <button
                type="button"
                onClick={() => setLocale('en')}
                className={`rounded-md px-2 py-1.5 text-[11px] font-semibold ${!ru ? 'bg-stone-900 text-white' : 'text-stone-500'}`}
              >
                EN
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <a href="/" className="mb-8 inline-flex items-center gap-2 text-xs font-semibold text-stone-500 hover:text-stone-900">
          <ArrowLeft className="h-3.5 w-3.5" />
          {ru ? 'Вернуться в Content Radar' : 'Back to Content Radar'}
        </a>

        <div className="mb-8">
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-stone-950 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-stone-500">{subtitle}</p>
          <p className="mt-2 text-xs text-stone-400">{ru ? 'Дата вступления в силу:' : 'Effective date:'} {EFFECTIVE_DATE}</p>
        </div>

        <article className="space-y-8 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
          {body}
        </article>

        <footer className="mt-8 flex flex-col gap-3 border-t border-stone-200 pt-6 text-xs text-stone-400 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Content Radar</span>
          <div className="flex flex-wrap gap-4">
            {nav.map(item => <a key={item.href} href={item.href} className="hover:text-stone-700">{item.label}</a>)}
          </div>
        </footer>
      </section>
    </main>
  );

  const heading = (title: string) => <h2 className="text-lg font-bold text-stone-950">{title}</h2>;
  const paragraph = (text: string) => <p className="mt-2 text-sm leading-7 text-stone-600">{text}</p>;

  if (kind === 'privacy') {
    return shell(
      ru ? 'Политика конфиденциальности' : 'Privacy Policy',
      ru
        ? 'Как Content Radar обрабатывает данные аккаунта, подключённых интеграций и контента.'
        : 'How Content Radar handles account, integration, and content data.',
      <>
        <section>
          {heading(ru ? '1. Какие данные мы обрабатываем' : '1. Information we process')}
          {paragraph(ru
            ? 'Content Radar может обрабатывать данные аккаунта (имя, email, идентификатор пользователя), настройки Radar, добавленные ссылки и источники, сценарии, загруженные медиафайлы, расписание публикаций, технические журналы и данные подключённых интеграций.'
            : 'Content Radar may process account information (name, email, user identifier), Radar preferences, submitted links and sources, scripts, uploaded media, publication schedules, technical logs, and data from connected integrations.')}
        </section>

        <section>
          {heading(ru ? '2. Google и социальные интеграции' : '2. Google and social integrations')}
          {paragraph(ru
            ? 'Если вы подключаете Google Calendar, YouTube, Instagram или TikTok, Content Radar получает только те разрешения, которые вы явно подтверждаете. Токены доступа используются для выполнения запрошенных вами действий, например синхронизации календаря или публикации контента.'
            : 'If you connect Google Calendar, YouTube, Instagram, or TikTok, Content Radar receives only the permissions you explicitly approve. Access tokens are used to perform actions you request, such as calendar synchronization or content publishing.')}
        </section>

        <section>
          {heading(ru ? '3. Для чего используются данные' : '3. How information is used')}
          {paragraph(ru
            ? 'Данные используются для работы продукта: персонализации рекомендаций, анализа выбранного контента, генерации идей и сценариев, сохранения рабочего процесса, планирования и выполнения публикаций, а также диагностики ошибок и безопасности.'
            : 'Information is used to operate the product: personalize recommendations, analyze selected content, generate ideas and scripts, preserve workflow state, plan and perform publications, and provide diagnostics and security.')}
        </section>

        <section>
          {heading(ru ? '4. Сторонние сервисы' : '4. Service providers')}
          {paragraph(ru
            ? 'Для отдельных функций Content Radar может передавать необходимые данные поставщикам инфраструктуры и API, включая Google/Firebase, AI-провайдеров, сервисы транскрипции и социальные платформы. Передаются только данные, необходимые для выполнения соответствующей функции.'
            : 'For specific features, Content Radar may send required information to infrastructure and API providers, including Google/Firebase, AI providers, transcription services, and social platforms. Only information needed to perform the relevant feature is sent.')}
        </section>

        <section>
          {heading(ru ? '5. Хранение и безопасность' : '5. Storage and security')}
          {paragraph(ru
            ? 'Данные приложения хранятся в используемой Content Radar облачной инфраструктуре. Секреты интеграций и серверные ключи не предназначены для отображения клиенту. Токены социальных интеграций хранятся на сервере в зашифрованном виде, когда это предусмотрено интеграцией.'
            : 'Application data is stored in the cloud infrastructure used by Content Radar. Integration secrets and server keys are not intended to be exposed to the client. Social integration tokens are stored server-side in encrypted form where supported by the integration.')}
        </section>

        <section>
          {heading(ru ? '6. Ваш контроль' : '6. Your choices')}
          {paragraph(ru
            ? 'Вы можете отключать подключённые интеграции. Для Instagram отключение удаляет сохранённую серверную запись интеграции, включая зашифрованный токен доступа. Инструкции доступны на странице «Удаление данных».'
            : 'You can disconnect connected integrations. For Instagram, disconnecting removes the stored server integration record, including the encrypted access token. Instructions are available on the Data Deletion page.')}
          <a href="/data-deletion" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
            {ru ? 'Инструкции по удалению данных' : 'Data deletion instructions'}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </section>

        <section>
          {heading(ru ? '7. Изменения политики' : '7. Policy changes')}
          {paragraph(ru
            ? 'Мы можем обновлять эту политику при изменении продукта, интеграций или требований законодательства. Актуальная версия всегда публикуется по этому адресу.'
            : 'We may update this policy when the product, integrations, or applicable requirements change. The current version is always published at this URL.')}
        </section>
      </>
    );
  }

  if (kind === 'terms') {
    return shell(
      ru ? 'Условия использования' : 'Terms of Service',
      ru
        ? 'Основные правила использования Content Radar.'
        : 'The basic terms for using Content Radar.',
      <>
        <section>
          {heading(ru ? '1. Сервис' : '1. Service')}
          {paragraph(ru
            ? 'Content Radar помогает находить материалы, анализировать источники, создавать идеи и сценарии, планировать и публиковать контент через подключённые сервисы. Возможности могут меняться по мере развития продукта.'
            : 'Content Radar helps discover material, analyze sources, create ideas and scripts, plan content, and publish through connected services. Features may change as the product evolves.')}
        </section>

        <section>
          {heading(ru ? '2. Ваш аккаунт' : '2. Your account')}
          {paragraph(ru
            ? 'Вы отвечаете за безопасность своего аккаунта и за действия, совершённые через него. Не передавайте доступ к аккаунту или подключённым интеграциям лицам, которым вы не доверяете.'
            : 'You are responsible for the security of your account and actions performed through it. Do not share account or integration access with people you do not trust.')}
        </section>

        <section>
          {heading(ru ? '3. Ваш контент и права' : '3. Your content and rights')}
          {paragraph(ru
            ? 'Вы сохраняете права на контент, который загружаете или создаёте. Вы подтверждаете, что имеете право использовать материалы, которые передаёте Content Radar, и несёте ответственность за итоговые публикации.'
            : 'You retain rights to content you upload or create. You confirm that you have the right to use material you provide to Content Radar and are responsible for final publications.')}
        </section>

        <section>
          {heading(ru ? '4. AI-функции' : '4. AI features')}
          {paragraph(ru
            ? 'Результаты AI могут содержать ошибки или неточности. Перед публикацией вы должны самостоятельно проверить факты, права на материалы, формулировки и соответствие правилам выбранной платформы.'
            : 'AI outputs may contain errors or inaccuracies. Before publishing, you should independently review facts, rights, wording, and compliance with the rules of the destination platform.')}
        </section>

        <section>
          {heading(ru ? '5. Подключённые платформы' : '5. Connected platforms')}
          {paragraph(ru
            ? 'Использование Google, Instagram, YouTube, TikTok и других интеграций также регулируется условиями соответствующих платформ. Content Radar не гарантирует постоянную доступность сторонних API.'
            : 'Use of Google, Instagram, YouTube, TikTok, and other integrations is also subject to the terms of those platforms. Content Radar does not guarantee uninterrupted availability of third-party APIs.')}
        </section>

        <section>
          {heading(ru ? '6. Запрещённое использование' : '6. Prohibited use')}
          {paragraph(ru
            ? 'Нельзя использовать Content Radar для незаконной деятельности, несанкционированного доступа, нарушения прав других лиц, распространения вредоносного ПО или обхода ограничений сторонних платформ.'
            : 'You may not use Content Radar for unlawful activity, unauthorized access, infringement of others’ rights, distribution of malicious software, or circumvention of third-party platform restrictions.')}
        </section>

        <section>
          {heading(ru ? '7. Изменения и прекращение работы' : '7. Changes and availability')}
          {paragraph(ru
            ? 'Мы можем изменять или прекращать отдельные функции, особенно если меняются сторонние API, требования безопасности или правила платформ. Существенные изменения этих условий отражаются в опубликованной версии.'
            : 'We may change or discontinue features, particularly when third-party APIs, security requirements, or platform rules change. Material changes to these terms are reflected in the published version.')}
        </section>
      </>
    );
  }

  return shell(
    ru ? 'Удаление данных' : 'Data Deletion',
    ru
      ? 'Как отключить Instagram и удалить данные интеграции из Content Radar.'
      : 'How to disconnect Instagram and remove integration data from Content Radar.',
    <>
      <section>
        {heading(ru ? 'Удаление данных Instagram' : 'Delete Instagram integration data')}
        {paragraph(ru
          ? 'Если вы подключали Instagram к Content Radar, вы можете удалить сохранённые данные интеграции самостоятельно.'
          : 'If you connected Instagram to Content Radar, you can remove the stored integration data yourself.')}
        <ol className="mt-4 space-y-3 text-sm leading-6 text-stone-600">
          <li><b className="text-stone-900">1.</b> {ru ? 'Войдите в свой аккаунт Content Radar.' : 'Sign in to your Content Radar account.'}</li>
          <li><b className="text-stone-900">2.</b> {ru ? 'Откройте Settings → Connections.' : 'Open Settings → Connections.'}</li>
          <li><b className="text-stone-900">3.</b> {ru ? 'Найдите Instagram и нажмите Disconnect / Отключить.' : 'Find Instagram and choose Disconnect.'}</li>
          <li><b className="text-stone-900">4.</b> {ru ? 'После подтверждения серверная запись Instagram-интеграции удаляется.' : 'After confirmation, the server-side Instagram integration record is removed.'}</li>
        </ol>
      </section>

      <section>
        {heading(ru ? 'Что удаляется' : 'What is removed')}
        {paragraph(ru
          ? 'Удаляется сохранённая запись подключения Instagram, включая Instagram account ID, отображаемые данные профиля, сохранённые scopes и зашифрованный access token. Отключение не удаляет уже опубликованный контент из Instagram.'
          : 'The stored Instagram connection record is removed, including the Instagram account ID, displayed profile metadata, stored scopes, and encrypted access token. Disconnecting does not remove content that has already been published to Instagram.')}
      </section>

      <section>
        {heading(ru ? 'Дополнительное удаление' : 'Additional deletion requests')}
        {paragraph(ru
          ? 'Если вам требуется удалить другие данные аккаунта Content Radar, используйте контакт поддержки, указанный в интерфейсе приложения или в карточке Content Radar на платформе, через которую вы подключили сервис. В запросе укажите email аккаунта Content Radar и явно напишите, какие данные вы хотите удалить.'
          : 'If you need other Content Radar account data removed, use the support contact shown in the application or in the Content Radar listing on the platform through which you connected the service. Include your Content Radar account email and clearly state which data you want deleted.')}
      </section>

      <section>
        {heading(ru ? 'Отзыв доступа у Meta' : 'Revoke access at Meta')}
        {paragraph(ru
          ? 'Дополнительно вы можете отозвать разрешения Content Radar в настройках подключённых приложений вашего аккаунта Meta/Instagram. Это прекращает дальнейший доступ по выданному токену.'
          : 'You can also revoke Content Radar permissions from the connected-app settings of your Meta/Instagram account. This prevents further access using the previously granted authorization.')}
      </section>
    </>
  );
};
