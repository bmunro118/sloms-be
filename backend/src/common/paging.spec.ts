import { PagingDto, PagedResult } from './paging';

describe('PagingDto', () => {
  it('defaults to page 1, limit 25', () => {
    const p = new PagingDto();
    expect(p.page).toBe(1);
    expect(p.limit).toBe(25);
  });

  it('calculates offset correctly for page 1', () => {
    const p = new PagingDto();
    expect(p.offset).toBe(0);
  });

  it('calculates offset correctly for page 2 with default limit', () => {
    const p = new PagingDto();
    p.page = 2;
    expect(p.offset).toBe(25);
  });

  it('calculates offset for custom page and limit', () => {
    const p = new PagingDto();
    p.page = 3;
    p.limit = 10;
    expect(p.offset).toBe(20);
  });

  it('handles undefined page/limit gracefully', () => {
    const p = new PagingDto();
    p.page = undefined;
    p.limit = undefined;
    expect(p.offset).toBe(0);
  });
});

describe('PagedResult', () => {
  function paging(page: number, limit: number): PagingDto {
    const p = new PagingDto();
    p.page = page;
    p.limit = limit;
    return p;
  }

  it('sets data, total, page, limit correctly', () => {
    const result = new PagedResult(['a', 'b'], 50, paging(1, 25));
    expect(result.data).toEqual(['a', 'b']);
    expect(result.total).toBe(50);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(25);
  });

  it('calculates pageCount correctly', () => {
    expect(new PagedResult([], 100, paging(1, 25)).pageCount).toBe(4);
    expect(new PagedResult([], 26, paging(1, 25)).pageCount).toBe(2);
    expect(new PagedResult([], 25, paging(1, 25)).pageCount).toBe(1);
  });

  it('pageCount is at least 1 when total is 0', () => {
    expect(new PagedResult([], 0, paging(1, 25)).pageCount).toBe(1);
  });

  it('hasNextPage is true when not on last page', () => {
    expect(new PagedResult([], 50, paging(1, 25)).hasNextPage).toBe(true);
  });

  it('hasNextPage is false on last page', () => {
    expect(new PagedResult([], 50, paging(2, 25)).hasNextPage).toBe(false);
  });

  it('hasPreviousPage is false on page 1', () => {
    expect(new PagedResult([], 50, paging(1, 25)).hasPreviousPage).toBe(false);
  });

  it('hasPreviousPage is true on page 2+', () => {
    expect(new PagedResult([], 50, paging(2, 25)).hasPreviousPage).toBe(true);
  });
});
