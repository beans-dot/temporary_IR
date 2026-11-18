'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api, type TargetTreeNode } from '@/lib/api';
import {
  findAggregatableNode,
  toGroupTarget,
  toIndividualTargetFromNode,
  type AggregatableNode,
} from '@/lib/targetSelection';
import { cn } from '@/lib/utils';
import { useAnalysisStore } from '@/store/AnalysisStoreProvider';
import { type SelectedTarget } from '@/store/useDashboardStore';
import { Checkbox } from '@/components/ui/checkbox';

/** 스토어 트리와 무관하게 현재 노드에서 바로 그룹 대상 생성 */
function buildGroupFromNode(
  node: TargetTreeNode,
  pathLabel: string,
  ancestorUnivCode?: string,
  ancestorIsYeonsung?: boolean,
): { target: SelectedTarget; descendantKeys: string[] } | null {
  const univCode = node.univCode ?? ancestorUnivCode;
  const isYeonsung = !!(node.isYeonsung || ancestorIsYeonsung);

  const collectDepts = (n: TargetTreeNode, u?: string): string[] => {
    const out: string[] = [];
    const walk = (x: TargetTreeNode, uu?: string) => {
      const code = x.univCode ?? uu;
      if (x.level === 'dept' && x.deptCode && code) out.push(x.deptCode);
      x.children?.forEach((c) => walk(c, x.univCode ?? uu));
    };
    walk(n, u);
    return out;
  };

  const collectUnivs = (n: TargetTreeNode): string[] => {
    const codes = new Set<string>();
    const walk = (x: TargetTreeNode) => {
      if (x.level === 'univ' && x.univCode) codes.add(x.univCode);
      x.children?.forEach(walk);
    };
    walk(n);
    return Array.from(codes);
  };

  const collectKeys = (n: TargetTreeNode, u?: string): string[] => {
    const keys = new Set<string>([n.id]);
    const walk = (x: TargetTreeNode, uu?: string) => {
      keys.add(x.id);
      const code = x.univCode ?? uu;
      if (x.level === 'dept' && x.deptCode && code) {
        keys.add(`${code}::${x.deptCode}`);
      }
      if (x.level === 'univ' && x.univCode) keys.add(x.univCode);
      x.children?.forEach((c) => walk(c, x.univCode ?? uu));
    };
    walk(n, u);
    return Array.from(keys);
  };

  // 타대학 상위 위계
  if (
    !(node.isYeonsung && node.level === 'root') &&
    ['root', 'schoolType', 'region', 'regionCity'].includes(node.level)
  ) {
    const memberUnivCodes = collectUnivs(node);
    if (memberUnivCodes.length === 0) return null;
    return {
      target: {
        key: node.id,
        label: `${pathLabel} (평균)`,
        isYeonsung: false,
        mode: 'group',
        memberUnivCodes,
      },
      descendantKeys: collectKeys(node),
    };
  }

  // 연성대 root → 자체 경쟁력은 전 학과 평균, 공시는 대학 단위 1개
  if (node.isYeonsung && node.level === 'root' && univCode) {
    if (node.memberDeptCodes && node.memberDeptCodes.length > 0) {
      return {
        target: {
          key: node.id,
          label: node.label,
          isYeonsung: true,
          mode: 'group',
          univCode,
          memberDeptCodes: node.memberDeptCodes,
        },
        descendantKeys: [node.id],
      };
    }
    return {
      target: {
        key: univCode,
        label: node.label,
        isYeonsung: true,
        mode: 'individual',
        univCode,
      },
      descendantKeys: collectKeys(node, univCode),
    };
  }

  // 계열 → 소속 학과 평균
  if (node.level === 'series') {
    if (!univCode) return null;
    const memberDeptCodes = collectDepts(node, univCode);
    if (memberDeptCodes.length === 0) return null;
    return {
      target: {
        key: node.id,
        label: `${pathLabel} (평균)`,
        isYeonsung: !!(node.isYeonsung || isYeonsung),
        mode: 'group',
        univCode,
        memberDeptCodes,
      },
      descendantKeys: collectKeys(node, univCode),
    };
  }

  return null;
}

function TreeNode({
  node,
  depth,
  pathLabel,
  ancestorUnivCode,
  ancestorIsYeonsung,
}: {
  node: TargetTreeNode;
  depth: number;
  pathLabel: string;
  ancestorUnivCode?: string;
  ancestorIsYeonsung?: boolean;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const tree = useAnalysisStore((s) => s.targetTree);
  const selectedTargets = useAnalysisStore((s) => s.selectedTargets);
  const toggleHierarchyGroup = useAnalysisStore((s) => s.toggleHierarchyGroup);
  const toggleIndividualTarget = useAnalysisStore((s) => s.toggleIndividualTarget);

  const hasChildren = !!node.children && node.children.length > 0;
  const isDept = node.level === 'dept';
  const isUniv = node.level === 'univ';
  const isYeonsungRoot = !!node.isYeonsung && node.level === 'root';
  const isSection = node.level === 'section';

  const localGroup = useMemo(
    () => buildGroupFromNode(node, pathLabel, ancestorUnivCode, ancestorIsYeonsung),
    [node, pathLabel, ancestorUnivCode, ancestorIsYeonsung],
  );

  const aggNode = useMemo(
    () => findAggregatableNode(tree, node.id),
    [tree, node.id],
  );
  const hierarchyNode: AggregatableNode | undefined =
    aggNode && aggNode.kind !== 'univ-individual' ? aggNode : undefined;

  const selectedKeys = useMemo(
    () => new Set(selectedTargets.map((t) => t.key)),
    [selectedTargets],
  );

  const checkState = (() => {
    if (localGroup || hierarchyNode) {
      const id = localGroup?.target.key ?? hierarchyNode!.id;
      return selectedKeys.has(id);
    }
    if (isUniv) {
      const key = node.univCode ?? node.id;
      return selectedKeys.has(key);
    }
    if (isDept && node.selectable && node.univCode && node.deptCode) {
      return selectedKeys.has(`${node.univCode}::${node.deptCode}`);
    }
    return false;
  })();

  const canToggle =
    !!localGroup ||
    !!hierarchyNode ||
    ((isUniv || isYeonsungRoot) && !!node.univCode) ||
    (isDept && !!node.selectable && !!node.univCode);

  const onToggle = (e?: Event) => {
    e?.preventDefault?.();
    // 위계 그룹: 학과/대학을 펼치지 않고 평균 1개만 선택
    if (localGroup) {
      toggleHierarchyGroup(localGroup.target, localGroup.descendantKeys);
      return;
    }
    if (hierarchyNode) {
      toggleHierarchyGroup(toGroupTarget(hierarchyNode), hierarchyNode.descendantKeys);
      return;
    }
    if (isUniv && node.univCode) {
      toggleIndividualTarget(toIndividualTargetFromNode(node), [
        node.id,
        node.univCode,
      ]);
      return;
    }
    if (isDept && node.selectable && node.univCode) {
      toggleIndividualTarget(toIndividualTargetFromNode(node), []);
    }
  };

  const isGroupNode =
    localGroup?.target.mode === 'group' ||
    (!!hierarchyNode && hierarchyNode.kind !== 'univ-individual');

  if (isSection) {
    return (
      <div className="mb-2">
        <div
          className="px-1 py-1.5 text-xs font-bold text-muted-foreground"
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          {node.label}
        </div>
        {node.children?.map((child) => {
          const nextPath =
            child.level === 'root' || child.level === 'series'
              ? child.label
              : child.label;
          return (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              pathLabel={nextPath}
              ancestorUnivCode={node.univCode ?? ancestorUnivCode}
              ancestorIsYeonsung={!!node.isYeonsung || !!ancestorIsYeonsung}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded px-1 py-1 hover:bg-accent"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground"
            aria-label={expanded ? '접기' : '펼치기'}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={checkState}
            onCheckedChange={() => onToggle()}
            disabled={!canToggle}
          />
          <span
            className={cn(
              (node.isYeonsung || ancestorIsYeonsung) && 'font-bold text-primary',
              !node.selectable && depth === 0 && 'font-bold',
            )}
          >
            {node.label}
            {isGroupNode && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                평균
              </span>
            )}
          </span>
        </label>
      </div>

      {expanded &&
        node.children?.map((child) => {
          const nextPath = (() => {
            if (child.level === 'dept' || child.level === 'univ') return child.label;
            if (child.level === 'series') {
              const base =
                node.level === 'root' || node.level === 'univ'
                  ? pathLabel || node.label
                  : pathLabel;
              return base ? `${base} · ${child.label}` : child.label;
            }
            if (node.level === 'root' && !node.isYeonsung) return child.label;
            return pathLabel ? `${pathLabel} · ${child.label}` : child.label;
          })();
          return (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              pathLabel={nextPath}
              ancestorUnivCode={node.univCode ?? ancestorUnivCode}
              ancestorIsYeonsung={!!node.isYeonsung || !!ancestorIsYeonsung}
            />
          );
        })}
    </div>
  );
}

/** 공시 조회용: 연성대 계열·학과 children 제거 (대학 단위만) */
function stripDisclosureDeptHierarchy(nodes: TargetTreeNode[]): TargetTreeNode[] {
  return nodes.map((node) => {
    if (node.children?.length) {
      const children = stripDisclosureDeptHierarchy(node.children);
      if (node.isYeonsung && node.level === 'root') {
        return { ...node, children: undefined };
      }
      return { ...node, children };
    }
    if (node.isYeonsung && node.level === 'root') {
      return { ...node, children: undefined };
    }
    return node;
  });
}

export function TargetTree() {
  const [tree, setTree] = useState<TargetTreeNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const setTargetTree = useAnalysisStore((s) => s.setTargetTree);
  const analysisScope = useAnalysisStore((s) => s.analysisScope);
  const years = useAnalysisStore((s) => s.years);

  useEffect(() => {
    let cancelled = false;
    const catalogYear = years.length ? Math.max(...years) : undefined;
    const path =
      analysisScope === 'internal'
        ? catalogYear
          ? `/universities/tree?scope=internal&year=${catalogYear}&years=${years.join(',')}`
          : '/universities/tree?scope=internal'
        : '/universities/tree';
    api
      .get<TargetTreeNode[]>(path)
      .then(({ data }) => {
        if (cancelled) return;
        // 공시(library): 대학 단위만 조회 → 연성대 계열·학과 위계는 노출하지 않음
        const next =
          analysisScope === 'disclosure'
            ? stripDisclosureDeptHierarchy(data)
            : data;
        setTree(next);
        setTargetTree(next);
      })
      .catch(() => {
        if (cancelled) return;
        setTree([]);
        setTargetTree([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [setTargetTree, analysisScope, years]);

  return (
    <div className="max-h-[420px] overflow-y-auto rounded-md border p-2">
      {!loaded && (
        <p className="p-2 text-sm text-muted-foreground">불러오는 중...</p>
      )}
      {loaded && tree.length === 0 && (
        <p className="p-2 text-sm text-muted-foreground">
          대상 데이터가 없습니다. 시딩 또는 업로드 후 이용하세요.
        </p>
      )}
      {tree.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          pathLabel={node.label}
          ancestorUnivCode={node.univCode}
          ancestorIsYeonsung={!!node.isYeonsung}
        />
      ))}
    </div>
  );
}
