import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

type ChartType = 'region-sales' | 'product-sales' | 'monthly-trend';

interface UploadResponse {
  datasetId: string;
  fileName: string;
  rowCount: number;
  columns: string[];
}

interface PreviewResponse {
  datasetId: string;
  totalRows: number;
  page: number;
  pageSize: number;
  columns: string[];
  rows: Record<string, string | null>[];
}

interface MetricCard {
  label: string;
  value: string;
  hint?: string;
}

interface MetricsResponse {
  rowCount: number;
  cards: MetricCard[];
}

interface ChartPoint {
  label: string;
  value: number;
}

interface ChartResponse {
  type: ChartType;
  title: string;
  points: ChartPoint[];
  note?: string;
}

interface ChatMessage {
  role: string;
  content: string;
  timestamp: string;
}

interface AgentResponse {
  sessionId: string;
  answer: string;
  suggestedCharts: ChartType[];
  history: ChatMessage[];
  source?: 'openai' | 'fallback' | 'error';
  debugMessage?: string;
}

interface LegendItem {
  label: string;
  value: number;
  percent: number;
  color: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  apiBaseUrl = 'https://sales-data-analyzer-5rl9.onrender.com';
  apiKey = '';
  pageSize = 20;
  page = 1;
  totalRows = 0;
  totalPages = 0;

  selectedFile: File | null = null;
  datasetId = '';
  sessionId = '';

  isUploading = false;
  isLoadingPreview = false;
  isLoadingMetrics = false;
  isLoadingCharts = false;
  isAsking = false;

  infoMessage = '';
  errorMessage = '';

  columns: string[] = [];
  rows: Record<string, string | null>[] = [];
  metrics: MetricCard[] = [];

  regionChart: ChartResponse | null = null;
  productChart: ChartResponse | null = null;
  trendChart: ChartResponse | null = null;
  selectedInsightChart: ChartType = 'region-sales';

  question = '';
  chatHistory: ChatMessage[] = [];
  aiSource: 'openai' | 'fallback' | 'error' | 'unknown' = 'unknown';
  aiDebugMessage = '';

  readonly quickQuestions = [
    "Top 3 productni ko'rsat",
    "Qaysi region eng kuchli?",
    "Oxirgi oylar trendini aytib ber"
  ];

  readonly workflowSteps = [
    '1. Upload CSV/XLSX',
    '2. Parse and Normalize',
    '3. Analytics Tools',
    '4. Agent Insight'
  ];

  private readonly chartColors = ['#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#84cc16'];

  constructor(private readonly http: HttpClient) {
    this.apiKey = localStorage.getItem('openai_api_key') ?? '';
  }

  get hasDataset(): boolean {
    return this.datasetId.length > 0;
  }

  get insightChart(): ChartResponse | null {
    if (this.selectedInsightChart === 'product-sales') {
      return this.productChart;
    }

    if (this.selectedInsightChart === 'monthly-trend') {
      return this.trendChart;
    }

    return this.regionChart;
  }

  onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.selectedFile = target.files?.[0] ?? null;
    this.errorMessage = '';

    if (this.selectedFile) {
      this.infoMessage = `Tanlangan fayl: ${this.selectedFile.name}`;
    }
  }

  async upload(): Promise<void> {
    if (!this.selectedFile) {
      this.errorMessage = 'Avval CSV yoki XLSX fayl tanlang.';
      return;
    }

    this.resetViewState();
    this.isUploading = true;

    try {
      const formData = new FormData();
      formData.append('file', this.selectedFile);

      const response = await firstValueFrom(
        this.http.post<UploadResponse>(`${this.apiBaseUrl}/api/files/upload`, formData)
      );

      this.datasetId = response.datasetId;
      this.columns = response.columns;
      this.totalRows = response.rowCount;
      this.totalPages = Math.max(1, Math.ceil(this.totalRows / this.pageSize));
      this.page = 1;
      this.infoMessage = `${response.fileName} yuklandi. ${response.rowCount} qator topildi.`;

      await this.loadDashboard();
    } catch (error: any) {
      this.errorMessage = this.extractError(error, 'Upload jarayonida xatolik.');
    } finally {
      this.isUploading = false;
    }
  }

  async loadDashboard(): Promise<void> {
    await Promise.all([this.loadPreview(), this.loadMetrics(), this.loadAllCharts()]);
  }

  async loadPreview(page = this.page): Promise<void> {
    if (!this.datasetId) {
      return;
    }

    this.isLoadingPreview = true;
    this.page = page;

    try {
      const response = await firstValueFrom(
        this.http.get<PreviewResponse>(
          `${this.apiBaseUrl}/api/datasets/${this.datasetId}/preview?page=${this.page}&pageSize=${this.pageSize}`
        )
      );

      this.columns = response.columns;
      this.rows = response.rows;
      this.totalRows = response.totalRows;
      this.totalPages = Math.max(1, Math.ceil(this.totalRows / this.pageSize));
    } catch (error: any) {
      this.errorMessage = this.extractError(error, 'Previewni yuklashda xatolik.');
    } finally {
      this.isLoadingPreview = false;
    }
  }

  async loadMetrics(): Promise<void> {
    if (!this.datasetId) {
      return;
    }

    this.isLoadingMetrics = true;
    try {
      const response = await firstValueFrom(
        this.http.get<MetricsResponse>(`${this.apiBaseUrl}/api/datasets/${this.datasetId}/metrics`)
      );
      this.metrics = response.cards;
    } catch (error: any) {
      this.errorMessage = this.extractError(error, 'Metricsni yuklashda xatolik.');
    } finally {
      this.isLoadingMetrics = false;
    }
  }

  async loadAllCharts(): Promise<void> {
    if (!this.datasetId) {
      return;
    }

    this.isLoadingCharts = true;

    try {
      const [region, product, trend] = await Promise.all([
        this.fetchChart('region-sales'),
        this.fetchChart('product-sales'),
        this.fetchChart('monthly-trend')
      ]);

      this.regionChart = region;
      this.productChart = product;
      this.trendChart = trend;
    } catch (error: any) {
      this.errorMessage = this.extractError(error, 'Chartlarni yuklashda xatolik.');
    } finally {
      this.isLoadingCharts = false;
    }
  }

  async askQuestion(): Promise<void> {
    const cleanedQuestion = this.question.trim();
    if (!this.datasetId || !cleanedQuestion) {
      return;
    }

    this.isAsking = true;
    this.errorMessage = '';

    try {
      const response = await firstValueFrom(
        this.http.post<AgentResponse>(`${this.apiBaseUrl}/api/agent/ask`, {
          datasetId: this.datasetId,
          question: cleanedQuestion,
          sessionId: this.sessionId || null,
          apiKey: this.apiKey.trim() || null
        })
      );

      this.sessionId = response.sessionId;
      this.chatHistory = response.history;
      this.aiSource = response.source ?? 'unknown';
      this.aiDebugMessage = response.debugMessage ?? '';
      this.question = '';

      if (response.suggestedCharts.length > 0) {
        this.selectedInsightChart = response.suggestedCharts[0];
      }

      await this.loadAllCharts();
    } catch (error: any) {
      this.errorMessage = this.extractError(error, 'Agent javobini olishda xatolik.');
    } finally {
      this.isAsking = false;
    }
  }

  useQuickQuestion(question: string): void {
    this.question = question;
    void this.askQuestion();
  }

  onApiKeyChange(): void {
    localStorage.setItem('openai_api_key', this.apiKey);
  }

  async previousPage(): Promise<void> {
    if (this.page > 1) {
      await this.loadPreview(this.page - 1);
    }
  }

  async nextPage(): Promise<void> {
    if (this.page < this.totalPages) {
      await this.loadPreview(this.page + 1);
    }
  }

  barWidth(value: number, chart: ChartResponse | null): string {
    if (!chart || chart.points.length === 0) {
      return '0%';
    }

    const max = Math.max(...chart.points.map((point) => point.value), 1);
    const width = (value / max) * 100;
    return `${Math.max(8, width)}%`;
  }

  donutStyle(): string {
    const chart = this.regionChart;
    if (!chart || chart.points.length === 0) {
      return 'conic-gradient(#dbeafe 0 100%)';
    }

    const points = chart.points.slice(0, 6);
    const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;

    let cursor = 0;
    const segments = points.map((point, index) => {
      const start = (cursor / total) * 100;
      cursor += Math.max(point.value, 0);
      const end = (cursor / total) * 100;
      return `${this.color(index)} ${start}% ${end}%`;
    });

    if (cursor < total) {
      segments.push(`#cbd5e1 ${(cursor / total) * 100}% 100%`);
    }

    return `conic-gradient(${segments.join(',')})`;
  }

  donutLegend(): LegendItem[] {
    const chart = this.regionChart;
    if (!chart || chart.points.length === 0) {
      return [];
    }

    const points = chart.points.slice(0, 6);
    const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;

    return points.map((point, index) => ({
      label: point.label,
      value: point.value,
      percent: Math.round((point.value / total) * 100),
      color: this.color(index)
    }));
  }

  trendPolyline(): string {
    const chart = this.trendChart;
    if (!chart || chart.points.length === 0) {
      return '';
    }

    const width = 680;
    const height = 220;
    const xStep = chart.points.length > 1 ? width / (chart.points.length - 1) : width;
    const max = Math.max(...chart.points.map((point) => point.value), 1);

    return chart.points
      .map((point, index) => {
        const x = index * xStep;
        const y = height - (point.value / max) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }

  trendLabels(): string[] {
    return this.trendChart?.points.map((point) => point.label) ?? [];
  }

  private async fetchChart(type: ChartType): Promise<ChartResponse> {
    return firstValueFrom(
      this.http.get<ChartResponse>(`${this.apiBaseUrl}/api/datasets/${this.datasetId}/charts?type=${type}`)
    );
  }

  color(index: number): string {
    return this.chartColors[index % this.chartColors.length];
  }

  private resetViewState(): void {
    this.errorMessage = '';
    this.infoMessage = '';
    this.datasetId = '';
    this.sessionId = '';
    this.rows = [];
    this.metrics = [];
    this.regionChart = null;
    this.productChart = null;
    this.trendChart = null;
    this.chatHistory = [];
    this.aiSource = 'unknown';
    this.aiDebugMessage = '';
  }

  private extractError(error: any, fallback: string): string {
    if (typeof error?.error === 'string') {
      return error.error;
    }

    if (typeof error?.error?.title === 'string') {
      return error.error.title;
    }

    if (typeof error?.message === 'string') {
      return error.message;
    }

    return fallback;
  }
}

