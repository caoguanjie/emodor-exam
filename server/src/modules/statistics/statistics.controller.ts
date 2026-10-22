import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import { StatisticsService } from './statistics.service';
import { Roles, roleHas } from '../../common/guards/roles.guard';
import { SkipEnvelope } from '../../common/response.interceptor';
import { Errors, RoleEnum } from '../../common/errors';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../access/access.service';

/** 兼容历史统计查询；管理访问受统计权限保护，普通学员仅能查询本人。 */
@Controller('statistics')
export class StatisticsController {
  constructor(
    private readonly stats: StatisticsService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  @Get('regulations')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
  allOverviews() {
    return this.stats.allRegulationsOverview();
  }

  @Get('regulations/:id/overview')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
  overview(@Param('id') id: string) {
    return this.stats.regulationOverview(id);
  }

  @Get('regulations/:id/departments')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
  departments(@Param('id') id: string) {
    return this.stats.departmentBreakdown(id);
  }

  @Get('regulations/:id/uncompleted')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
  uncompleted(@Param('id') id: string) {
    return this.stats.uncompletedList(id);
  }

  @Get('users/:id')
  async personal(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    // 数据范围收口：employee 仅本人（FR-STT-03 验收②，40302）
    const permissions = await this.access.permissions(user.id);
    const canReadOthers = roleHas(user.role, [RoleEnum.SUPER_ADMIN]) || permissions.includes('statistics:read');
    if (!canReadOthers && Number(id) !== user.id) {
      throw Errors.dataForbidden();
    }
    return this.stats.personal(id);
  }

  @Get('export')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
  @SkipEnvelope()
  async export(
    @Query('type') type: string,
    @Query('regulation_id') regulationId: string | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const wb = new ExcelJS.Workbook();
    let filename = 'export.xlsx';
    let rowCount = 0;

    if (type === 'regulation_overview') {
      filename = '制度维度统计表.xlsx';
      const ws = wb.addWorksheet('制度统计');
      ws.columns = [
        { header: '制度标题', key: 'title', width: 30 },
        { header: '分类', key: 'category', width: 14 },
        { header: '状态', key: 'status', width: 10 },
        { header: '应学人数', key: 'assigned', width: 10 },
        { header: '有效学习人数', key: 'valid', width: 12 },
        { header: '学习完成率', key: 'completion', width: 12 },
        { header: '参考人数', key: 'participants', width: 10 },
        { header: '通过人数', key: 'passed', width: 10 },
        { header: '通过率', key: 'passRate', width: 10 },
        { header: '平均分', key: 'avg', width: 10 },
        { header: '[0,60)', key: 'b0', width: 8 },
        { header: '[60,70)', key: 'b1', width: 8 },
        { header: '[70,80)', key: 'b2', width: 8 },
        { header: '[80,90)', key: 'b3', width: 8 },
        { header: '[90,100]', key: 'b4', width: 8 },
      ];
      const { list } = await this.stats.allRegulationsOverview();
      for (const o of list as any[]) {
        ws.addRow({
          title: o.title, category: o.category,
          status: { draft: '草稿', published: '已发布', archived: '已归档' }[o.status as 'draft'] || o.status,
          assigned: o.assigned_count, valid: o.learning.valid_count,
          completion: `${(o.learning.completion_rate * 100).toFixed(1)}%`,
          participants: o.exam.participant_count, passed: o.exam.passed_count,
          passRate: `${(o.exam.pass_rate * 100).toFixed(1)}%`, avg: o.exam.average_score,
          b0: o.exam.score_distribution['[0,60)'], b1: o.exam.score_distribution['[60,70)'],
          b2: o.exam.score_distribution['[70,80)'], b3: o.exam.score_distribution['[80,90)'],
          b4: o.exam.score_distribution['[90,100]'],
        });
        rowCount++;
      }
    } else if (type === 'uncompleted') {
      if (!regulationId) throw Errors.param('导出未完成人员清单须指定 regulation_id');
      filename = '未完成人员清单.xlsx';
      const ws = wb.addWorksheet('未完成人员');
      ws.columns = [
        { header: '部门', key: 'dept', width: 20 },
        { header: '姓名', key: 'name', width: 12 },
        { header: '工号', key: 'eno', width: 12 },
        { header: '未完成类型', key: 'type', width: 12 },
        { header: '累计有效时长(秒)', key: 'total', width: 16 },
        { header: '目标时长(秒)', key: 'required', width: 14 },
        { header: '剩余时长缺口(秒)', key: 'gap', width: 16 },
        { header: '已覆盖段数', key: 'covered', width: 12 },
        { header: '底部段是否覆盖', key: 'bottom', width: 14 },
        { header: '有效学习', key: 'valid', width: 10 },
        { header: '历次考试最高分', key: 'best', width: 14 },
        { header: '具体原因', key: 'reason', width: 40 },
      ];
      const { list } = await this.stats.uncompletedList(regulationId);
      const rows = list as any[];
      if (!rows.length) throw Errors.param('无未完成人员，不生成文件');
      for (const u of rows) {
        ws.addRow({
          dept: u.department_name, name: u.real_name, eno: u.employee_no || '', type: u.type,
          total: u.total_seconds, required: u.required_seconds, gap: u.remaining_seconds,
          covered: `${u.covered_count}/${u.total_segments}`,
          bottom: u.bottom_segment_covered ? '是' : '否',
          valid: u.is_valid ? '达标' : '未达标',
          best: u.best_score ?? '—', reason: u.reason,
        });
        rowCount++;
      }
    } else if (type === 'user_detail') {
      if (!regulationId) throw Errors.param('导出个人明细须指定 regulation_id');
      filename = '个人维度明细表.xlsx';
      const ws = wb.addWorksheet('个人明细');
      ws.columns = [
        { header: '姓名', key: 'name', width: 12 },
        { header: '工号', key: 'eno', width: 12 },
        { header: '部门', key: 'dept', width: 18 },
        { header: '制度标题', key: 'reg', width: 28 },
        { header: '累计有效时长(秒)', key: 'total', width: 16 },
        { header: '覆盖段数', key: 'covered', width: 10 },
        { header: '有效学习', key: 'valid', width: 10 },
        { header: '试卷标题', key: 'paper', width: 28 },
        { header: '作答次数', key: 'attempts', width: 10 },
        { header: '最高分', key: 'best', width: 10 },
        { header: '最终状态', key: 'status', width: 12 },
      ];
      const rows = await this.stats.regulationUserDetails(regulationId);
      for (const r of rows) {
        ws.addRow(r);
        rowCount++;
      }
    } else {
      throw Errors.param('type 取值非法（regulation_overview / uncompleted / user_detail）');
    }

    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
    this.audit.log({
      actor_id: user.id, actor_name: user.username, action: 'statistics.export', object_type: 'statistics',
      object_id: regulationId || null, detail: { type, rows: rowCount }, result: 'success', source_ip: req.ip || null,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.end(buf);
  }
}
